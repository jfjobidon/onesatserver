import config from "config"

// // for type safety in our data source class
// // import { objectEnumValues } from "@prisma/client/runtime/library"
import {
  User,
  UserInput,
  UserMutationResponse,
  Campaign,
  CampaignMutationResponse,
  CampaignInput,
  CampaignAll,
  Poll,
  PollInput,
  PollMutationResponse,
  PollOptionMutationResponse,
  PollOption,
  PollOptionInput,
  PollAll,
  FundingInput,
  FundingMutationResponse,
  PauseMutationResponse,
  PausePollInput,
  PauseCampaignInput,
  GetVotesQueryResponse,
  FavoriteElementMutationResponse,
  FavoriteInput
} from "./__generated__/resolvers-types"

// const UsersDB: Omit<Required<User>, "__typename">[] = usersData

// Only campaignPausedDefault remains used (createCampaign initializes
// paused from it). All other *Default constants were dropped when
// createCampaign and createPoll were hardened — every business field is
// now required server-side, the client owns UX defaults.
const campaignPausedDefault = config.get<boolean>('campaignPausedDefault')

// NOTE: Campaign prisma !== Campaign graphQL
import { Campaign as CampaignMongo, Poll as PollMongo, PollOption as PollOptionMongo, User as UserMongo, PrismaClient } from '@prisma/client'
import { DataSourcesRedis } from "./datasourcesredis.js"
import { validateSatsMax, validateSatsMin } from "./utils/satsBounds.js"
import { validateTitle, validateDescription, normalizeText } from "./utils/textBounds.js"
import { validateCampaignDates } from "./utils/dateBounds.js"
import { validateUsername } from "./utils/userBounds.js"
import { validateEmail } from "./utils/emailBounds.js"
// import { CampaignType } from "./utils/types"
const dataSourcesRedis = new DataSourcesRedis()
// import { describe } from "node:test"
// import { commandOptions } from "redis"
// import { clearScreenDown } from "readline"
const prisma = new PrismaClient()

export class DataSourcesMongo {

  async accountFunding(uid: string, fundingInput: FundingInput): Promise<FundingMutationResponse> {
    try {
      const result = await prisma.user.update({
        where: {
          uid: uid
        },
        data: {
          fundings: {
            createMany: {
              data: [
                {
                  invoice: fundingInput.invoice,
                  sats: fundingInput.sats,
                }
              ]
            }
          }
        },
        include: {
          fundings: true
        }
      })
      await dataSourcesRedis.incrUser(uid, fundingInput.sats)
      return {
        code: "200",
        success: true,
        message: "funding done",
        funding: {
          userId: uid,
          invoice: fundingInput.invoice,
          sats: fundingInput.sats,
          date: result.creationDate
        }
      }
    } catch(err) {
      console.log(err)
      return {
        code: "500",
        success: false,
        message: (err as Error)?.message || "funding failed",
        funding: null
      }
    }
  }

  async getUsers(): Promise<User[]> {
    // console.log("getUsers: prisma findMany")
    const users = await prisma.user.findMany({})
    // console.table(users)
    return users
  }

  async getUserByUserName(userName: string): Promise<User> {
    // console.log("in getUserByUserName")
    // console.log(userName)
    const user = await prisma.user.findUnique({ where: { userName: userName } })
    if (!user) throw new Error(`User not found: ${userName}`)
    return user
  }

  async getUserByEmail(email: string): Promise<User | null> {
    // console.log("in getUserByEmail")
    // console.log(email)
    const user = await prisma.user.findUnique({ where: { email: email } })
    // console.log("date user: " + user.creationDate)
    return user
    // return null
  }

  async favoriteElement(favoriteInput: FavoriteInput): Promise<FavoriteElementMutationResponse> {
    try {
      const user = await prisma.user.findUnique({ where: { uid: favoriteInput.uid } })
      if (user) {
        if (favoriteInput.isFavorite) {
          // element should not be in user.favorites --> add it
          if (user.favorites.includes(favoriteInput.elementId)) {
            // error: element is already in user's favorites
            return {
              code: "400",
              success: true,
              message: "element was already included in favorites",
              ...favoriteInput
            }
          } else {
            // OK, add element in favorites
            await prisma.user.update({
              data: {
                favorites: {
                  set: [...user.favorites, favoriteInput.elementId],
                },
              },
              where: { uid: favoriteInput.uid },
            })
            return {
              code: "400",
              success: true,
              message: "element successfully included in favorites",
              ...favoriteInput
            }
          }
        } else {
          // element should be in user.favorites --> remove it
          console.log("element should be in user.favorites --> remove it")
          // REVIEW:
          // const index = user.favorites.indexOf(favoriteInput.elementId)
          // if (index > -1) {...}
          if (user.favorites.includes(favoriteInput.elementId)) { 
            // OK, elementId is in user.favorites --> remove it
            console.log("OK, elementId is in user.favorites --> remove it")
            const elementIndex = user.favorites.indexOf(favoriteInput.elementId)
            user.favorites.splice(elementIndex, 1)
            await prisma.user.update({
              data: {
                favorites: {
                  set: [...user.favorites],
                },
              },
              where: { uid: favoriteInput.uid },
            })
            return {
              code: "400",
              success: true,
              message: "elementId has been successfully removed",
              ...favoriteInput
            }
          } else {
            // error: elementId is NOT in user.favorites --> cannot remove it
            return {
              code: "200",
              success: false,
              message: "error: elementId is NOT in user.favorites --> cannot remove it",
              ...favoriteInput
            }
          }
        }
      } else {
        return {
          code: "200",
          success: false,
          message: "Error: user does NOT exist",
          ...favoriteInput
        }
      }
    } catch(error) {
      console.log("error mongo")
      console.log(error)
      return {
        code: "200",
        success: false,
        message: "error database",
        ...favoriteInput
      }
    }
  }

  async getCampaign(campaignId: string): Promise<Campaign> {
    try {
      const campaign: CampaignMongo | null = await prisma.campaign.findUnique({ where: {id: campaignId} })
      if (campaign === null) {
        // DB invariant: any reachable campaignId must resolve to a campaign.
        // Cleanup scripts must remove dangling references (favorites, votes, polls)
        // when a campaign is deleted, so callers never see an orphan id.
        throw new Error(`Inconsistent DB: campaign ${campaignId} not found`)
      } else {
        const sats = await dataSourcesRedis.getSatsForCampaign(campaignId)
        const nbVotes = await dataSourcesRedis.getNbVotesForCampaign(campaignId)
        const nbViews = await dataSourcesRedis.getNbViewsForCampaign(campaignId)
        // isFavorite/isVoted are user-relative: stub at false here (the graphql
        // layer can override per-viewer if needed). Schema declares them Boolean!
        // so we MUST return them.
        return {...campaign, sats: sats, votes: nbVotes, views: nbViews, isFavorite: false, isVoted: false}
      }
    }
    catch(error) {
      console.log(error)  // TODO: logError(error)
      throw error
    }
  }

  async getCampaigns(uid: string, campaignType: string): Promise<Campaign[]> {
    // if campaignType === ALL --> returns all database !!!
    // console.log("getCampaigns uid", uid)
    // console.log("getCampaigns campaignType", campaignType)

    switch (campaignType) {
      case 'USER':
        try {
          const campaignsMongo: CampaignMongo[] = await prisma.campaign.findMany({ where: {authorId: uid} })
          const voteds = await dataSourcesRedis.getVoted(uid)
          // const campaignsMongo: CampaignMongo[] = await prisma.campaign.findMany()
          // console.log("campaignsMongo length", campaignsMongo.length)
          if (campaignsMongo === null) {
            return []
          } else {
            let campaigns: Campaign[] = []
    
            for (const campaign of campaignsMongo) {
              // console.table(campaign)
              // console.log("paused", campaign.paused)
              const sats = await dataSourcesRedis.getSatsForCampaign(campaign.id)
              const votes = await dataSourcesRedis.getNbVotesForCampaign(campaign.id)
              const views = await dataSourcesRedis.getNbViewsForCampaign(campaign.id)
              const isFavorite = true // since campaignType is USER ==> isFavorite will not be used
              const isVoted = voteds.includes(campaign.id)
              campaigns.push({...campaign, isFavorite, isVoted, sats, votes, views})
            }
            return campaigns
          }
        }
        catch(error) {
          console.log(error)  // TODO: logError(error)
          return []
        }
        break
      case 'FAVORITES':
        try {
          const campaigns: Campaign[] = []
          const favorites = await this.getFavorites(uid) // [campaignId] TODO: campaigns + polls + pollOptions
          const voteds = await dataSourcesRedis.getVoted(uid)
          if (favorites.length === 0) {
            return []
          } else {
            for (const favorite of favorites) {
              const campaign = await this.getCampaign(favorite)
              // Skip deleted campaigns that are still referenced in the user's favorites
              if (!campaign || !campaign.id) continue
              const isFavorite = true // obviously
              const isVoted = voteds.includes(favorite)
              const sats = await dataSourcesRedis.getSatsForCampaign(favorite)
              const votes = await dataSourcesRedis.getNbVotesForCampaign(favorite)
              const views = await dataSourcesRedis.getNbViewsForCampaign(favorite)
              campaigns.push({...campaign, isFavorite, isVoted, sats, votes, views})
            }
            return campaigns
          }
        }
        catch(error) {
          console.log(error)  // TODO: logError(error)
          return []
        }
      case 'VOTED':
        try {
          const campaigns: Campaign[] = []
          const voteds = await dataSourcesRedis.getVoted(uid) // [campaignId] TODO: campaigns + polls + pollOptions
          const favorites = await this.getFavorites(uid)
          if (voteds.length === 0) {
            return []
          } else {
            for (const voted of voteds) {
              console.log("voted", voted)
              const campaign = await this.getCampaign(voted)
              const isFavorite = favorites.includes(voted)
              const isVoted = true  // obviously
              const sats = await dataSourcesRedis.getSatsForCampaign(voted)
              const votes = await dataSourcesRedis.getNbVotesForCampaign(voted)
              const views = await dataSourcesRedis.getNbViewsForCampaign(voted)
              campaigns.push({...campaign, isFavorite, isVoted, sats, votes, views})
            }
            return campaigns
          }
        }
        catch(error) {
          console.log(error)  // TODO: logError(error)
          return []
        }
      default:    // ALL
        try {
          // Hide DRAFT / READY campaigns from non-authors. Authors still see their own
          // unpublished campaigns via the USER tab.
          const campaignsMongo: CampaignMongo[] = await prisma.campaign.findMany({
            where: {
              OR: [
                { status: { notIn: ['draft', 'ready'] } },
                { authorId: uid },
              ],
            },
          })
          const favorites = await this.getFavorites(uid)
          const voteds = await dataSourcesRedis.getVoted(uid)
          if (campaignsMongo === null) {
            return []
          } else {
            let campaigns: Campaign[] = []
            for (const campaign of campaignsMongo) {
              const isFavorite = favorites.includes(campaign.id)
              const isVoted = voteds.includes(campaign.id)
              const sats = await dataSourcesRedis.getSatsForCampaign(campaign.id)
              const votes = await dataSourcesRedis.getNbVotesForCampaign(campaign.id)
              const views = await dataSourcesRedis.getNbViewsForCampaign(campaign.id)
              campaigns.push({...campaign, isFavorite, isVoted, sats, votes, views})
            }
            return campaigns
          }
        }
        catch(error) {
          console.log(error)  // TODO: logError(error)
          return []
        }
    }
  }

  async getCampaignAll(campaignId: string, viewerUid?: string): Promise<CampaignAll | null> {
    try {
      const campaign: CampaignMongo | null = await prisma.campaign.findUnique({ where: {id: campaignId} })
      if (campaign === null) {
        return null
      }
      // Hide DRAFT / READY from non-authors. The campaign exists, but only the author can fetch it.
      if ((campaign.status === 'draft' || campaign.status === 'ready') && campaign.authorId !== viewerUid) {
        return null
      }
      const polls = await this.getPollsAllForCampaign(campaignId)
      // console.log("polls")
      // console.log(polls)
      // const polls = []
      const sats = await dataSourcesRedis.getSatsForCampaign(campaignId)
      const votes = await dataSourcesRedis.getNbVotesForCampaign(campaignId)
      const views = await dataSourcesRedis.getNbViewsForCampaign(campaignId)
      return {...campaign, pollsAll: polls, sats: sats, votes, views}
    }
    catch(error) {
      console.log(error)  // TODO: logError(error)
      return null
    }
  }

  async togglePausePoll(pausePollInput: PausePollInput) : Promise<PauseMutationResponse> {
    const poll: PollMongo | null = await prisma.poll.findUnique({ where: {id: pausePollInput.pollId} })
    if (!poll) throw new Error(`Inconsistent DB: poll ${pausePollInput.pollId} not found`)
    const updatePoll = await prisma.poll.update({
      where: {
        id: pausePollInput.pollId,
      },
      data: {
        paused: {
          set: !poll.paused
        },
      },
    })
    const campaign: CampaignMongo | null = await prisma.campaign.findUnique({ where: {id: poll.campaignId} })
    if (!campaign) throw new Error(`Inconsistent DB: campaign ${poll.campaignId} not found`)

    const polls = await this.getPollsForCampaign(campaign.id)
    const pollsStatus: any = polls.map(poll => {
      return {
        pollId: poll.id,
        paused: poll.paused
      }
    })
    return {
      code: "404",
      success: true,
      message: "voila",
      campaignStatus: {
          campaignId: poll.campaignId,
          campaignPaused: campaign.paused,
          newItemId: pausePollInput.pollId,
          newItemPaused: !poll.paused,
          pollsStatus: pollsStatus
        }
    }
  }

  async togglePauseCampaign(pauseCampaignInput: PauseCampaignInput) : Promise<PauseMutationResponse> {
    const campaign: CampaignMongo | null = await prisma.campaign.findUnique({ where: {id: pauseCampaignInput.campaignId} })
    if (!campaign) throw new Error(`Inconsistent DB: campaign ${pauseCampaignInput.campaignId} not found`)
    const updateCampaign = await prisma.campaign.update({
      where: {
        id: pauseCampaignInput.campaignId
      },
      data: {
        paused: {
          set: !campaign.paused
        },
      },
    })

    const polls = await this.getPollsForCampaign(campaign.id)
    const pollsStatus: any = polls.map(poll => {
      return {
        pollId: poll.id,
        paused: poll.paused
      }
    })
    return {
      code: "404",
      success: true,
      message: "voila",
      campaignStatus: {
          campaignId: campaign.id,
          campaignPaused: !campaign.paused,
          newItemId: campaign.id,
          newItemPaused: !campaign.paused,
          pollsStatus: pollsStatus
        }
    }
  }

  async getPoll(pollId: string): Promise<Poll> {
    const poll: PollMongo | null = await prisma.poll.findUnique({ where: {id: pollId} })
    if (!poll) throw new Error(`Inconsistent DB: poll ${pollId} not found`)
    const sats = await dataSourcesRedis.getSatsForPoll(pollId)
    const nbVotes = await dataSourcesRedis.getNbVotesForPoll(pollId)
    const nbViews = await dataSourcesRedis.getNbViewsForPoll(pollId)
    const pollOptions = await this.getPollOptionsForPoll(pollId)
    // console.table(poll)
    const campaign = await this.getCampaign(poll.campaignId)
    return {...poll, startingDate: campaign.startingDate, endingDate: campaign.endingDate, sats, votes: nbVotes, views: nbViews, pollOptions: pollOptions}
  }

  async getPollsForCampaign(campaignId: string): Promise<Poll[]> {
    // const campaign = await prisma.campaign.findUnique({ where: {id: campaignId} })
    // return campaign.polls
    // const polls = await prisma.poll.findMany({ where: {campaignId: campaignId}})
    const pollsMongo: PollMongo[] = await prisma.poll.findMany({ where: {campaignId: campaignId} })
    const campaign = await this.getCampaign(campaignId)
    if (pollsMongo === null) {
      return []
    } else {
      let polls: Poll[] = []

      for (const poll of pollsMongo) {
        // console.table(poll)
        // console.log("paused", poll.paused)
        const sats = await dataSourcesRedis.getSatsForPoll(poll.id)
        const votes = await dataSourcesRedis.getNbVotesForPoll(poll.id)
        const views = await dataSourcesRedis.getNbViewsForPoll(poll.id)
        polls.push({...poll, startingDate: campaign.startingDate, endingDate: campaign.endingDate, sats, votes, views, pollOptions: []})
      }
      // by default: sorting polls by sats DESC
      polls.sort(function(a, b) {
        return b.sats - a.sats;
      })
      return polls
    }
  }

  async getPollsAllForCampaign(campaignId: string): Promise<PollAll[]> {
    let pollsAllMongo: PollMongo[] = await prisma.poll.findMany({ where: {campaignId: campaignId} })
    const campaign = await this.getCampaign(campaignId)
    // console.log("polslallmongo")
    // console.table(pollsAllMongo)
    let pollsAll: PollAll[] = []
    for (const pollAll of pollsAllMongo) {
      // console.log("pollAll")
      // console.table(pollAll)
      const pollOptions = await this.getPollOptionsForPoll(pollAll.id)
      // console.log("pollOptions", pollOptions)
      const sats = await dataSourcesRedis.getSatsForPoll(pollAll.id)
      const votes = await dataSourcesRedis.getNbVotesForPoll(pollAll.id)
      // console.log("getNbVotesForPoll", votes)
      const views = await dataSourcesRedis.getNbViewsForPoll(pollAll.id)
      // console.log("getNbViewsForPoll", views)
      pollsAll.push({...pollAll, startingDate: campaign.startingDate, endingDate: campaign.endingDate, sats, votes, views, pollOptions})
    }
    // console.log("res pollsAll")
    // console.table(pollsAll)
    // by default: sorting polls by sats DESC
    pollsAll.sort(function(a, b) {
      return b.sats - a.sats;
    })
    return pollsAll
  }

  async getPollOption(pollOptionId: string): Promise<PollOption> {
    const pollOption: PollOptionMongo | null = await prisma.pollOption.findUnique({ where: { id: pollOptionId}})
    if (!pollOption) throw new Error(`Inconsistent DB: pollOption ${pollOptionId} not found`)
    // console.log(pollOption)
    const sats = await dataSourcesRedis.getSatsForPollOption(pollOptionId)
    const nbVotes = await dataSourcesRedis.getNbVotesForPollOption(pollOptionId)
    const nbViews = await dataSourcesRedis.getNbViewsForPollOption(pollOptionId)
    const aVotes: GetVotesQueryResponse = await dataSourcesRedis.getVotesForPollOption(pollOptionId)
    return {...pollOption, sats: sats, votes: nbVotes, views: nbViews, aVotes: aVotes.votes}
  }

  async getPollOptionsForPoll(pollId: string): Promise<PollOption[]> {
    const pollOptionsMongo: PollOptionMongo[] = await prisma.pollOption.findMany({ where: {pollId: pollId} })

    // return pollOptions
    if (pollOptionsMongo === null) {
      return []
    } else {
      let pollOptions: PollOption[] = []

      for (const pollOption of pollOptionsMongo) {
        // console.table(pollOption)
        // console.log("paused", pollOption.paused)
        const sats = await dataSourcesRedis.getSatsForPollOption(pollOption.id)
        const votes = await dataSourcesRedis.getNbVotesForPollOption(pollOption.id)
        const views = await dataSourcesRedis.getNbViewsForPollOption(pollOption.id)
        pollOptions.push({...pollOption, sats, votes, views, aVotes: []}) // FIXME: TODO: get aVotes
      }
      // by default: sorting pollOptions by sats DESC
      pollOptions.sort(function(a, b) {
        return b.sats - a.sats;
      })
      return pollOptions
    }
  }

  async createCampaign(campaignInput: CampaignInput, authorId: string): Promise<CampaignMutationResponse> {
    console.log("createCampaign campaignInput")
    console.log(campaignInput)

    const titleErr = validateTitle(campaignInput.title)
    if (titleErr) return { code: "400", success: false, message: titleErr, campaign: null }
    const descErr = validateDescription(campaignInput.description)
    if (descErr) return { code: "400", success: false, message: descErr, campaign: null }
    const title = normalizeText(campaignInput.title)
    const description = normalizeText(campaignInput.description)

    const minErr = validateSatsMin('Minimum', campaignInput.minSatPerVote)
    if (minErr) return { code: "400", success: false, message: minErr, campaign: null }
    const maxErr = validateSatsMax('Maximum', campaignInput.maxSatPerVote)
    if (maxErr) return { code: "400", success: false, message: maxErr, campaign: null }
    const suggestedErr = validateSatsMax('Suggested', campaignInput.suggestedSatPerVote)
    if (suggestedErr) return { code: "400", success: false, message: suggestedErr, campaign: null }
    if (campaignInput.minSatPerVote! > campaignInput.maxSatPerVote!) {
      return { code: "400", success: false, message: "Minimum sats per vote must be ≤ maximum", campaign: null }
    }
    const sug = campaignInput.suggestedSatPerVote!, lo = campaignInput.minSatPerVote!, hi = campaignInput.maxSatPerVote!
    if (sug < lo || sug > hi) {
      return { code: "400", success: false, message: `Suggested sats per vote must be between ${lo} and ${hi}`, campaign: null }
    }

    // CampaignInput fields are now all required by the GraphQL schema, so no
    // server-side defaults. The client controls UX defaults explicitly.
    const minSatPerVote = campaignInput.minSatPerVote
    const maxSatPerVote = campaignInput.maxSatPerVote
    const suggestedSatPerVote = campaignInput.suggestedSatPerVote
    const isPrivate = campaignInput.isPrivate
    const blindAmount = campaignInput.blindAmount
    const blindRank = campaignInput.blindRank
    const blindVote = campaignInput.blindVote
    const allowMultipleVotes = campaignInput.allowMultipleVotes
    const creationDate = new Date()
    const startingDate = new Date(campaignInput.startingDate)
    const endingDate = new Date(campaignInput.endingDate)

    const dateErr = validateCampaignDates(startingDate, endingDate, creationDate)
    if (dateErr) {
      return { code: "400", success: false, message: dateErr, campaign: null }
    }

    // Verify the User record exists in MongoDB before attempting the relational
    // update (otherwise Prisma throws an opaque P2025 → caught as a generic 500).
    const userExists = await prisma.user.findUnique({ where: { uid: authorId } })
    if (!userExists) {
      return { code: "404", success: false, message: "User not found", campaign: null }
    }

    try {
      const result = await prisma.user.update({
        where: {
          uid: authorId,
        },
        data: {
          campaigns: {
            createMany: {
              data: [
                {
                  title: title,
                  description: description,
                  minSatPerVote: minSatPerVote,
                  maxSatPerVote: maxSatPerVote,
                  suggestedSatPerVote: suggestedSatPerVote,
                  creationDate: creationDate,
                  updatedDate: creationDate,
                  startingDate: startingDate,
                  endingDate: endingDate,
                  paused: campaignPausedDefault,
                  status: "draft",
                  isPrivate: isPrivate,
                  blindAmount: blindAmount,
                  blindRank: blindRank,
                  blindVote: blindVote,
                  allowMultipleVotes: allowMultipleVotes
                }
              ]
            }
          }
        },
        include: {
          campaigns: true
        },
      })
      return {
        code: "200",
        success: true,
        message: "Campaign created!",
        campaign: {
          id: result.campaigns[result.campaigns.length - 1].id, // REVIEW: new created campaign allways last ?
          authorId: authorId,
          title: title,
          description: description,
          startingDate: startingDate,
          endingDate: endingDate,
          message: null,
          minSatPerVote: minSatPerVote,
          maxSatPerVote: maxSatPerVote,
          suggestedSatPerVote: suggestedSatPerVote,
          paused: campaignPausedDefault,
          status: "draft",
          isPrivate: isPrivate,
          blindAmount: blindAmount,
          blindRank: blindRank,
          blindVote: blindVote,
          allowMultipleVotes: allowMultipleVotes,
          creationDate: creationDate,
          updatedDate: creationDate,
          // TODO: schema declares isFavorite/isVoted as Boolean! — they are
          // user-relative fields not meaningful at creation time. If a future
          // query requests them in the createCampaign response, populate them
          // here (default to false) or remove them from the Campaign type.
          isFavorite: false,
          isVoted: false,
          sats: 0,
          votes: 0,
          views: 0
        },
      }
    } catch (err) {
      console.log("err", err)
      return {
        code: "500",
        success: false,
        message: "Error creating campaign: " + (err as Error).message,
        campaign: null
      }
    }
  }

  // Recompute campaign.status between 'draft' and 'ready' based on poll readiness.
  // Never overwrites 'published' / 'active' / 'ended' — those transitions are explicit.
  async recomputeCampaignStatus(campaignId: string): Promise<void> {
    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        include: { polls: { include: { pollOptions: true } } },
      })
      if (!campaign) return
      if (campaign.status !== 'draft' && campaign.status !== 'ready') return

      const isReady =
        campaign.polls.length > 0 &&
        campaign.polls.every(p => p.pollOptions.length >= 2)
      const desired = isReady ? 'ready' : 'draft'
      if (campaign.status === desired) return

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: desired, updatedDate: new Date() },
      })
    } catch (err) {
      console.log('recomputeCampaignStatus err', err)
    }
  }

  async publishCampaign(campaignId: string): Promise<CampaignMutationResponse> {
    console.log("publishCampaign campaignId", campaignId)
    try {
      // Get campaign with polls and poll options
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        include: { polls: { include: { pollOptions: true } } }
      })
      if (!campaign) {
        return { code: "404", success: false, message: "Campaign not found", campaign: null }
      }
      // Check readiness: at least 1 poll, each with at least 2 options
      if (campaign.polls.length === 0) {
        return { code: "400", success: false, message: "Campaign needs at least 1 poll", campaign: null }
      }
      const incompletePoll = campaign.polls.find(p => p.pollOptions.length < 2)
      if (incompletePoll) {
        return { code: "400", success: false, message: `Poll "${incompletePoll.title}" needs at least 2 options`, campaign: null }
      }
      // Publish
      const updated = await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: "published", updatedDate: new Date() }  // CampaignStatus.PUBLISHED
      })
      return {
        code: "200",
        success: true,
        message: "Campaign published!",
        campaign: {
          id: updated.id,
          authorId: updated.authorId,
          title: updated.title,
          description: updated.description,
          startingDate: updated.startingDate,
          endingDate: updated.endingDate,
          message: updated.message,
          minSatPerVote: updated.minSatPerVote,
          maxSatPerVote: updated.maxSatPerVote,
          suggestedSatPerVote: updated.suggestedSatPerVote,
          paused: updated.paused,
          status: updated.status,
          isPrivate: updated.isPrivate,
          blindAmount: updated.blindAmount,
          blindRank: updated.blindRank,
          blindVote: updated.blindVote,
          allowMultipleVotes: updated.allowMultipleVotes,
          creationDate: updated.creationDate,
          updatedDate: updated.updatedDate,
          isFavorite: false,
          isVoted: false,
          sats: 0,
          votes: 0,
          views: 0
        }
      }
    } catch (err) {
      console.log("publishCampaign err", err)
      return {
        code: "500",
        success: false,
        message: "Error publishing campaign: " + (err as Error).message,
        campaign: null
      }
    }
  }

  /**
   * createPoll — see specs-for-server.md "createPoll" section for the full contract.
   *
   * Order of checks (first failure short-circuits):
   *   1. Format (title, description, sats)
   *   2. Sat range coherence (min ≤ max, min ≤ suggested ≤ max)
   *   3. Parent campaign exists
   *   4. Author check (context.userId === campaign.authorId)
   *   5. Campaign status (draft or ready)
   *   6. Sat inheritance (poll bounds within campaign bounds)
   *   7. Privacy inheritance (poll can strengthen, not relax)
   *   8. Insert + catch P2002 on (campaignId, titleLower) for title uniqueness
   */
  async createPoll(pollInput: PollInput, authorId: string): Promise<PollMutationResponse> {
    const campaignId = pollInput.campaignId

    // 1. Format validation (text + sats)
    const titleErr = validateTitle(pollInput.title)
    if (titleErr) return { code: "400", success: false, message: titleErr, poll: null }
    const descErr = validateDescription(pollInput.description)
    if (descErr) return { code: "400", success: false, message: descErr, poll: null }
    const title = normalizeText(pollInput.title)
    const description = normalizeText(pollInput.description)
    const titleLower = title.toLowerCase()

    const minErr = validateSatsMin('Minimum', pollInput.minSatPerVote)
    if (minErr) return { code: "400", success: false, message: minErr, poll: null }
    const maxErr = validateSatsMax('Maximum', pollInput.maxSatPerVote)
    if (maxErr) return { code: "400", success: false, message: maxErr, poll: null }
    const suggestedErr = validateSatsMax('Suggested', pollInput.suggestedSatPerVote)
    if (suggestedErr) return { code: "400", success: false, message: suggestedErr, poll: null }

    // 2. Sat range coherence (intra-poll)
    if (pollInput.minSatPerVote > pollInput.maxSatPerVote) {
      return { code: "400", success: false, message: "Minimum sats per vote must be ≤ maximum", poll: null }
    }
    const sug = pollInput.suggestedSatPerVote, lo = pollInput.minSatPerVote, hi = pollInput.maxSatPerVote
    if (sug < lo || sug > hi) {
      return { code: "400", success: false, message: `Suggested sats per vote must be between ${lo} and ${hi}`, poll: null }
    }

    // 3. Parent campaign exists
    const campaignMongo: CampaignMongo | null = await prisma.campaign.findUnique({ where: { id: campaignId } })
    if (!campaignMongo) {
      return { code: "404", success: false, message: "Campaign not found", poll: null }
    }

    // 4. Author check — caller must be the campaign's author
    if (campaignMongo.authorId !== authorId) {
      return { code: "403", success: false, message: "Only the campaign author can add a poll", poll: null }
    }

    // 5. Campaign status — only mutable while still in draft / ready
    if (campaignMongo.status !== 'draft' && campaignMongo.status !== 'ready') {
      // Pick the right article: "an active/ended" vs "a published/paused/scheduled" campaign.
      const article = /^[aeiou]/i.test(campaignMongo.status) ? 'an' : 'a'
      return {
        code: "409",
        success: false,
        message: `Cannot add a poll to ${article} ${campaignMongo.status} campaign`,
        poll: null,
      }
    }

    // 6. Sat inheritance — poll narrows but never widens the campaign range
    if (pollInput.minSatPerVote < campaignMongo.minSatPerVote) {
      return {
        code: "400",
        success: false,
        message: `Poll minimum cannot be lower than campaign minimum (${campaignMongo.minSatPerVote})`,
        poll: null,
      }
    }
    if (pollInput.maxSatPerVote > campaignMongo.maxSatPerVote) {
      return {
        code: "400",
        success: false,
        message: `Poll maximum cannot exceed campaign maximum (${campaignMongo.maxSatPerVote})`,
        poll: null,
      }
    }

    // 7. Privacy inheritance — a poll can strengthen but never relax
    if (campaignMongo.blindAmount && !pollInput.blindAmount) {
      return { code: "400", success: false, message: "Campaign requires blindAmount; poll cannot disable it", poll: null }
    }
    if (campaignMongo.blindRank && !pollInput.blindRank) {
      return { code: "400", success: false, message: "Campaign requires blindRank; poll cannot disable it", poll: null }
    }
    if (campaignMongo.blindVote && !pollInput.blindVote) {
      return { code: "400", success: false, message: "Campaign requires blindVote; poll cannot disable it", poll: null }
    }
    if (!campaignMongo.allowMultipleVotes && pollInput.allowMultipleVotes) {
      return { code: "400", success: false, message: "Campaign disables multiple votes; poll cannot enable them", poll: null }
    }

    // 8. Insert + catch P2002 (composite unique on campaignId + titleLower)
    const creationDate = new Date()
    try {
      const created: PollMongo = await prisma.poll.create({
        data: {
          campaignId,
          authorId,
          title,
          titleLower,
          description,
          paused: false,
          creationDate,
          updatedDate: creationDate,
          minSatPerVote: pollInput.minSatPerVote,
          maxSatPerVote: pollInput.maxSatPerVote,
          suggestedSatPerVote: pollInput.suggestedSatPerVote,
          blindAmount: pollInput.blindAmount,
          blindRank: pollInput.blindRank,
          blindVote: pollInput.blindVote,
          allowMultipleVotes: pollInput.allowMultipleVotes,
        },
      })

      // Recompute campaign status (draft ↔ ready) since adding a poll may flip readiness.
      await this.recomputeCampaignStatus(campaignId)

      return {
        code: "200",
        success: true,
        message: "Poll created!",
        poll: {
          id: created.id,
          campaignId: created.campaignId,
          authorId: created.authorId,
          title: created.title,
          description: created.description,
          paused: created.paused,
          creationDate: created.creationDate,
          // startingDate / endingDate on a Poll surface the parent campaign's window
          // (polls don't carry their own dates; they live for the campaign duration).
          startingDate: campaignMongo.startingDate,
          endingDate: campaignMongo.endingDate,
          updatedDate: created.updatedDate,
          minSatPerVote: created.minSatPerVote,
          maxSatPerVote: created.maxSatPerVote,
          suggestedSatPerVote: created.suggestedSatPerVote,
          blindAmount: created.blindAmount,
          blindRank: created.blindRank,
          blindVote: created.blindVote,
          allowMultipleVotes: created.allowMultipleVotes,
          pollOptions: [],
          sats: 0,
          votes: 0,
          views: 0,
        },
      }
    } catch (err: any) {
      // Composite unique on (campaignId, titleLower) — Prisma reports P2002.
      if (err?.code === "P2002") {
        return {
          code: "409",
          success: false,
          message: "A poll with this title already exists in this campaign",
          poll: null,
        }
      }
      console.log("createPoll mongo err", err)
      return {
        code: "500",
        success: false,
        message: "Error creating poll: " + (err as Error).message,
        poll: null,
      }
    }
  }

  async createPollOption(pollOptionInput: PollOptionInput, authorId: string): Promise<PollOptionMutationResponse> {
    const pollId = pollOptionInput.pollId

    // 1. Format validation
    const titleErr = validateTitle(pollOptionInput.title)
    if (titleErr) return { code: "400", success: false, message: titleErr, pollOption: null }
    const descErr = validateDescription(pollOptionInput.description)
    if (descErr) return { code: "400", success: false, message: descErr, pollOption: null }
    const title = normalizeText(pollOptionInput.title)
    const description = normalizeText(pollOptionInput.description)
    const titleLower = title.toLowerCase()

    // 2. Parent poll exists (also load campaign for ownership + status)
    const pollMongo = await prisma.poll.findUnique({
      where: { id: pollId },
      include: { campaign: true },
    })
    if (!pollMongo) {
      return { code: "404", success: false, message: "Poll not found", pollOption: null }
    }

    // 3. Author check — caller must be the campaign's author
    if (pollMongo.campaign.authorId !== authorId) {
      return { code: "403", success: false, message: "Only the campaign author can add a poll option", pollOption: null }
    }

    // 4. Campaign status — only mutable while still in draft / ready
    if (pollMongo.campaign.status !== 'draft' && pollMongo.campaign.status !== 'ready') {
      const article = /^[aeiou]/i.test(pollMongo.campaign.status) ? 'an' : 'a'
      return {
        code: "409",
        success: false,
        message: `Cannot add a poll option to ${article} ${pollMongo.campaign.status} campaign`,
        pollOption: null,
      }
    }

    // 5. Insert + 6. Composite unique catch (pollId, titleLower)
    try {
      const created = await prisma.pollOption.create({
        data: {
          pollId,
          title,
          titleLower,
          description,
        },
      })

      await this.recomputeCampaignStatus(pollMongo.campaignId)

      return {
        code: "200",
        success: true,
        message: "poll option created",
        pollOption: {
          id: created.id,
          pollId: created.pollId,
          title: created.title,
          description: created.description,
          sats: 0,
          votes: 0,
          views: 0,
          aVotes: [],
        },
      }
    } catch (err: any) {
      if (err?.code === "P2002") {
        return {
          code: "409",
          success: false,
          message: "An option with this title already exists in this poll",
          pollOption: null,
        }
      }
      console.log("createPollOption mongo err", err)
      return {
        code: "500",
        success: false,
        message: "Error creating poll option: " + (err as Error).message,
        pollOption: null,
      }
    }
  }

  async getUserById(id: string): Promise<User> {
    const user: UserMongo | null = await prisma.user.findUnique({ where: { id: id } })
    if (user === null) throw new Error(`Inconsistent DB: user ${id} not found`)
    const campaigns: CampaignMongo[] = await prisma.campaign.findMany({ where: {authorId: id} })

    let campaignsStats: Campaign[] = []
    for (const campaign of campaigns) {
      // console.log(campaign.id)
      // const sats = await dataSourcesRedis.getSatsForCampaign(campaign.id)
      let sats = 0
      try {
        // console.log("getSatsForCampaign", campaign.id)
        sats = await dataSourcesRedis.getSatsForCampaign(campaign.id)
      }
      catch(error) {
        console.log(error)
      }
      // DEBUG: error si le champ n'existe pas DEBUG:
      // console.table(pollOptions)
      // isFavorite/isVoted/views/votes are required by the Campaign type
      // but not computed here — stub at safe defaults; per-viewer enrichment
      // can happen in the resolver layer if/when needed.
      campaignsStats.push({...campaign, sats: <number>sats, isFavorite: false, isVoted: false, votes: 0, views: 0})
      // const pollOptions = await this.getPollOptionsForPoll(pollAll.id)
    }

    // for (var i = 0 i < campaigns.length i++) {
    //   campaigns[i] = {...campaigns[i], sats: 1, votes: 2, views: 3}
    // }

    // console.table(campaigns)
    return {...user, campaigns: campaignsStats}
    // return null
  }

  async getUserName(uid: string): Promise<string> {
    const user: UserMongo | null = await prisma.user.findUnique({ where: { uid: uid } })
    if (user === null) throw new Error(`Inconsistent DB: user ${uid} not found`)
    return user.userName
  }

  async getFavorites(uid: string): Promise<string[]> {
    const user: UserMongo | null = await prisma.user.findUnique({ where: { uid: uid } })
    if (user === null) throw new Error(`Inconsistent DB: user ${uid} not found`)
    return user.favorites
  }

  async signup(userInput: UserInput): Promise<UserMutationResponse> {
    // 1. Format validation (length, charset, reserved). Uniqueness is handled
    //    by the DB unique indexes on userName / userNameLower / email below.
    //    Defense in depth: Firebase already validates email at sign-up, but the
    //    GraphQL mutation is independent — we MUST revalidate at the trust boundary.
    const emailErr = validateEmail(userInput.email)
    if (emailErr) {
      return { code: "400", success: false, message: emailErr, user: null }
    }
    const usernameErr = validateUsername(userInput.userName)
    if (usernameErr) {
      return { code: "400", success: false, message: usernameErr, user: null }
    }

    // 2. Normalize. userName casing is preserved as the user typed it;
    //    userNameLower drives case-insensitive uniqueness. Email is stored
    //    lowercase (Firebase already does this, we mirror it for defense in depth).
    const userNameTrimmed = userInput.userName.trim()
    const userNameLower = userNameTrimmed.toLowerCase()
    const emailLower = userInput.email.trim().toLowerCase()

    // 3. Insert + map Prisma unique-constraint violations to UX-friendly messages.
    try {
      const userResponse = await prisma.user.create({
        data: {
          email: emailLower,
          userName: userNameTrimmed,
          userNameLower,
          uid: userInput.uid,
        },
      })
      return {
        code: "200",
        success: true,
        message: "New user created!",
        user: { ...userResponse },
      }
    } catch (err: any) {
      // P2002 = unique constraint violation. err.meta.target lists the field(s).
      if (err?.code === "P2002") {
        const target = Array.isArray(err.meta?.target)
          ? err.meta.target.join(",")
          : String(err.meta?.target ?? "")
        if (target.includes("userNameLower") || target.includes("userName")) {
          return { code: "409", success: false, message: "Username already taken", user: null }
        }
        if (target.includes("email")) {
          return { code: "409", success: false, message: "Email already registered", user: null }
        }
        return { code: "409", success: false, message: "A unique field collision occurred", user: null }
      }
      console.log(err)
      return {
        code: "500",
        success: false,
        message: "Error creating user: " + (err as Error).message,
        user: null,
      }
    }
  }

}

