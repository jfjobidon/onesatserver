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
  GetVotesQueryResponse,
  FavoriteElementMutationResponse,
  FavoriteInput
} from "./__generated__/resolvers-types"

// const UsersDB: Omit<Required<User>, "__typename">[] = usersData

const minSatPerVoteDefault = config.get<string>('minSatPerVoteDefault') 
const maxSatPerVoteDefault = config.get<string>('maxSatPerVoteDefault') 
const suggestedSatPerVoteDefault = config.get<string>('suggestedSatPerVoteDefault') 
const campaignPausedDefault = config.get<string>('campaignPausedDefault') 
const isPrivateDefault = config.get<string>('isPrivate') 
const blindAmountDefault = config.get<string>('blindAmount') 
const blindRankDefault = config.get<string>('blindRank') 
const blindVoteDefault = config.get<string>('blindVote') 
const allowMultipleVotesDefault = config.get<string>('allowMultipleVotes') 
// console.log("minSatPerVoteDefault " + minSatPerVoteDefault)
// console.log("maxSatPerVoteDefault " + maxSatPerVoteDefault)
// console.log("suggestedSatPerVoteDefault " + suggestedSatPerVoteDefault)
// console.log("campaignPausedDefault " + campaignPausedDefault)
// console.log("blindAmountDefault " + blindAmountDefault)
// console.log("blindRankDefault " + blindRankDefault)
// console.log("blindVoteDefault " + blindVoteDefault)
// console.log("allowMultipleVotesDefault " + allowMultipleVotesDefault)

// NOTE: Campaign prisma !== Campaign graphQL
import { Campaign as CampaignMongo, Poll as PollMongo, PollOption as PollOptionMongo, User as UserMongo, PrismaClient } from '@prisma/client'
import { DataSourcesRedis } from "./datasourcesredis.js"
import { validateSatsMax, validateSatsMin } from "./utils/satsBounds.js"
import { validateTitle, validateDescription, normalizeText } from "./utils/textBounds.js"
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
    const user = prisma.user.findUnique({ where: { userName: userName } })
    return user
  }

  async getUserByEmail(email: string): Promise<User> {
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
        await prisma.user.update({
          data: {
            favorites: {
              set: [...user.favorites, "jfakfklads"],
            },
          },
          where: { uid: favoriteInput.uid },
        })
        return {
          code: "400",
          success: true,
          message: "element added to favorites",
          ...favoriteInput
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
      const campaign: CampaignMongo = await prisma.campaign.findUnique({ where: {id: campaignId} })
      if (campaign === null) {
        return null
      } else {
        const sats = await dataSourcesRedis.getSatsForCampaign(campaignId)
        const nbVotes = await dataSourcesRedis.getNbVotesForCampaign(campaignId)
        const nbViews = await dataSourcesRedis.getNbViewsForCampaign(campaignId)
        return {...campaign, sats: sats, votes: nbVotes, views: nbViews}
      }
    }
    catch(error) {
      console.log(error)  // TODO: logError(error)
      return null
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
            return null
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
          return null
        }
        break
      case 'FAVORITES':
        try {
          const campaigns: Campaign[] = []
          const favorites = await this.getFavorites(uid) // [campaignId] TODO: campaigns + polls + pollOptions
          const voteds = await dataSourcesRedis.getVoted(uid)
          if (favorites.length === 0) {
            return null
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
          return null
        }
      case 'VOTED':
        try {
          const campaigns: Campaign[] = []
          const voteds = await dataSourcesRedis.getVoted(uid) // [campaignId] TODO: campaigns + polls + pollOptions
          const favorites = await this.getFavorites(uid)
          if (voteds.length === 0) {
            return null
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
          return null
        }
      default:    // ALL
        try {
          const campaignsMongo: CampaignMongo[] = await prisma.campaign.findMany()
          const favorites = await this.getFavorites(uid)
          const voteds = await dataSourcesRedis.getVoted(uid)
          if (campaignsMongo === null) {
            return null
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
          return null
        }
    }
  }

  async getCampaignAll(campaignId: string): Promise<CampaignAll> {
    try {
      const campaign: CampaignMongo = await prisma.campaign.findUnique({ where: {id: campaignId} })
      if (campaign === null) {
        return null
      } else {
        const polls = await this.getPollsAllForCampaign(campaignId)
        // console.log("polls")
        // console.log(polls)
        // const polls = []
        const sats = await dataSourcesRedis.getSatsForCampaign(campaignId)
        const votes = await dataSourcesRedis.getNbVotesForCampaign(campaignId)
        const views = await dataSourcesRedis.getNbViewsForCampaign(campaignId)
        return {...campaign, pollsAll: polls, sats: sats, votes, views}
      }
    }
    catch(error) {
      console.log(error)  // TODO: logError(error)
      return null
    }
  }

  async togglePausePoll(pausePollInput) : Promise<PauseMutationResponse> {
    const poll: PollMongo = await prisma.poll.findUnique({ where: {id: pausePollInput.pollId} })
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
    const campaign: CampaignMongo = await prisma.campaign.findUnique({ where: {id: poll.campaignId} })

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

  async togglePauseCampaign(pauseCampaignInput) : Promise<PauseMutationResponse> {
    const campaign: CampaignMongo = await prisma.campaign.findUnique({ where: {id: pauseCampaignInput.campaignId} })
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
    const poll: PollMongo = await prisma.poll.findUnique({ where: {id: pollId} })
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
        polls.push({...poll, startingDate: campaign.startingDate, endingDate: campaign.endingDate, sats, votes, views})
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
    const pollOption: PollOptionMongo = await prisma.pollOption.findUnique({ where: { id: pollOptionId}})
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

  async createCampaign(campaignInput: CampaignInput): Promise<CampaignMutationResponse> {
    console.log("createCampaign campaignInput")
    console.log(campaignInput)
    let authorId = campaignInput.authorId

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

    const minSatPerVote = campaignInput.minSatPerVote || minSatPerVoteDefault
    const maxSatPerVote = campaignInput.maxSatPerVote || maxSatPerVoteDefault
    const suggestedSatPerVote = campaignInput.suggestedSatPerVote || suggestedSatPerVoteDefault
    const isPrivate = campaignInput.isPrivate || isPrivateDefault
    const blindAmount = campaignInput.blindAmount || blindAmountDefault
    const blindRank = campaignInput.blindRank || blindRankDefault
    const blindVote = campaignInput.blindVote || blindVoteDefault
    const allowMultipleVotes = campaignInput.allowMultipleVotes || allowMultipleVotesDefault
    const creationDate = new Date()
    const startingDate = new Date(campaignInput.startingDate)
    const endingDate = new Date(campaignInput.endingDate)
    
    if (creationDate > startingDate) {
      console.log("creationDate NOT OK")
      // throw new Error("Creation Date cannot be in the past") // REVIEW: graphql: INTERNAL_SERVER_ERROR
    }

    if (startingDate > endingDate) {
      console.log("Ending Date MUST be later than Starting Date")
      // throw new Error("Creation Date cannot be in the past") // REVIEW: graphql: INTERNAL_SERVER_ERROR
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
          blindAmount: blindAmount,
          blindRank: blindRank,
          blindVote: blindVote,
          allowMultipleVotes: allowMultipleVotes,
          creationDate: creationDate,
          updatedDate: creationDate,
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
          blindAmount: updated.blindAmount,
          blindRank: updated.blindRank,
          blindVote: updated.blindVote,
          allowMultipleVotes: updated.allowMultipleVotes,
          creationDate: updated.creationDate,
          updatedDate: updated.updatedDate,
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

  async createPoll( pollInput: PollInput): Promise<PollMutationResponse> {
    const campaignId = pollInput.campaignId
    const authorId = pollInput.authorId

    const titleErr = validateTitle(pollInput.title)
    if (titleErr) return { code: "400", success: false, message: titleErr, poll: null }
    const descErr = validateDescription(pollInput.description)
    if (descErr) return { code: "400", success: false, message: descErr, poll: null }
    const title = normalizeText(pollInput.title)
    const description = normalizeText(pollInput.description)

    const pollsBefore = await this.getPollsForCampaign(campaignId)
    const titleKey = title.toLowerCase()
    const duplicate = pollsBefore.find(p => normalizeText(p.title).toLowerCase() === titleKey)
    if (duplicate) {
      return { code: "400", success: false, message: "A poll with this title already exists in this campaign", poll: null }
    }

    const minErr = validateSatsMin('Minimum', pollInput.minSatPerVote)
    if (minErr) return { code: "400", success: false, message: minErr, poll: null }
    const maxErr = validateSatsMax('Maximum', pollInput.maxSatPerVote)
    if (maxErr) return { code: "400", success: false, message: maxErr, poll: null }
    const suggestedErr = validateSatsMax('Suggested', pollInput.suggestedSatPerVote)
    if (suggestedErr) return { code: "400", success: false, message: suggestedErr, poll: null }
    if (pollInput.minSatPerVote! > pollInput.maxSatPerVote!) {
      return { code: "400", success: false, message: "Minimum sats per vote must be ≤ maximum", poll: null }
    }
    const sug = pollInput.suggestedSatPerVote!, lo = pollInput.minSatPerVote!, hi = pollInput.maxSatPerVote!
    if (sug < lo || sug > hi) {
      return { code: "400", success: false, message: `Suggested sats per vote must be between ${lo} and ${hi}`, poll: null }
    }

    const currentCampaign = await this.getCampaign(campaignId)
    if (!currentCampaign) {
      return { code: "404", success: false, message: "Parent campaign not found", poll: null }
    }
    if (pollInput.minSatPerVote !== currentCampaign.minSatPerVote) {
      return { code: "400", success: false, message: "Poll minimum must equal campaign minimum", poll: null }
    }
    if (pollInput.maxSatPerVote !== currentCampaign.maxSatPerVote) {
      return { code: "400", success: false, message: "Poll maximum must equal campaign maximum", poll: null }
    }
    if (sug < currentCampaign.minSatPerVote! || sug > currentCampaign.maxSatPerVote!) {
      return {
        code: "400",
        success: false,
        message: `Suggested must be between ${currentCampaign.minSatPerVote} and ${currentCampaign.maxSatPerVote} (campaign bounds)`,
        poll: null,
      }
    }

    const minSatPerVote = pollInput.minSatPerVote || minSatPerVoteDefault
    const maxSatPerVote = pollInput.maxSatPerVote || maxSatPerVoteDefault
    const suggestedSatPerVote = pollInput.suggestedSatPerVote || suggestedSatPerVoteDefault
    const blindAmount = pollInput.blindAmount || blindAmountDefault
    const blindRank = pollInput.blindRank || blindRankDefault
    const blindVote = pollInput.blindVote || blindVoteDefault
    const allowMultipleVotes = pollInput.allowMultipleVotes || allowMultipleVotesDefault
    const creationDate = new Date()
    const updatedDate = creationDate
    // const startingDate = new Date(pollInput.startingDate)
    // const endingDate = new Date(pollInput.endingDate)

    // pollsBefore is fetched above (uniqueness check) and reused below to find the new pollId
    console.log("createPoll campaignId", campaignId)
    console.log("createPoll authorId", authorId)

    try {
      const result = await prisma.campaign.update({
        where: {
          id: campaignId,
        },
        data: {
          polls: {
            createMany: {
              data: [
                {
                  // TODO:
                  // authorId: authorId.toString(),
                  // authorId: "66c4b26f8d94b6da2b1fa18d",
                  authorId: authorId,
                  title: title,
                  description: description,
                  paused: false,
                  creationDate: creationDate,
                  updatedDate: creationDate,
                  minSatPerVote: minSatPerVote,
                  maxSatPerVote: maxSatPerVote,
                  suggestedSatPerVote: suggestedSatPerVote,
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
          polls: true
        }
      })
      // extracting new pollId
      const pollsAfter = await this.getPollsForCampaign(campaignId)
      let newPollArray = pollsAfter.filter(pollAfter => pollsBefore.every(pollBefore => !(pollBefore.id === pollAfter.id)))
      const newPollId = newPollArray[0].id

      return {
        code: "200",
        success: true,
        message: "poll created!",
        poll: {
          id: newPollId,
          campaignId: campaignId,
          authorId: authorId,
          title: title,
          description: description,
          paused: false,
          creationDate: creationDate,
          startingDate: currentCampaign.startingDate,
          endingDate: currentCampaign.endingDate,
          updatedDate: updatedDate,
          minSatPerVote: minSatPerVote,
          maxSatPerVote: maxSatPerVote,
          suggestedSatPerVote: suggestedSatPerVote,
          allowMultipleVotes: allowMultipleVotes,
          blindAmount: blindAmount,
          blindRank: blindRank,
          blindVote: blindVote,
          pollOptions: [],
          sats: 0,
          views: 0,
          votes: 0
        },
      }
    } catch (err) {
      console.log("mongo err", err)
    }
  }

  // createPollOption(context.userId, pollOptionInput)
  // FIXME: REVIEW: remove authorId
  async createPollOption(authorId: String, pollOptionInput: PollOptionInput): Promise<PollOptionMutationResponse> {
     const pollId = pollOptionInput.pollId

     const titleErr = validateTitle(pollOptionInput.title)
     if (titleErr) return { code: "400", success: false, message: titleErr, pollOption: null }
     const descErr = validateDescription(pollOptionInput.description)
     if (descErr) return { code: "400", success: false, message: descErr, pollOption: null }
     const title = normalizeText(pollOptionInput.title)
     const description = normalizeText(pollOptionInput.description)

     const existingOptions = await this.getPollOptionsForPoll(pollId)
     const titleKey = title.toLowerCase()
     const duplicate = existingOptions.find(o => normalizeText(o.title).toLowerCase() === titleKey)
     if (duplicate) {
       return { code: "400", success: false, message: "An option with this title already exists in this poll", pollOption: null }
     }

     try {
      const result = await prisma.poll.update({
        where: {
          id: pollId
        },
        data: {
          pollOptions: {
            createMany: {
              data: [
                {
                  title: title,
                  description: description
                }
              ]
            }
          }
        },
        include: {
          pollOptions: true
        }
      })
      const pollOption = result.pollOptions.filter(pollOption => pollOption.title == title)

      return {
        code: "200",
        success: true,
        message: "poll option created",
        pollOption: {
          id: pollOption[0].id,
          pollId: pollId,
          title: title,
          description: description,
          sats: 0,
          votes: 0,
          views: 0,
          aVotes: []
        }
      }
     } catch (err) {
      console.log(err)
     }
  }

  async getUserById(id: string): Promise<null | User> {
    let user
    try {
      user = await prisma.user.findUnique({ where: { id: id } })
      if (user === null) {
        return null
      }
    }
    catch(error) {
      console.log("error user", error)
      return null
    }
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
      campaignsStats.push({...campaign, sats: <number>sats})
      // const pollOptions = await this.getPollOptionsForPoll(pollAll.id)
    }

    // for (var i = 0 i < campaigns.length i++) {
    //   campaigns[i] = {...campaigns[i], sats: 1, votes: 2, views: 3}
    // }

    // console.table(campaigns)
    return {...user, campaigns: campaignsStats}
    // return null
  }

  async getUserName(uid: string): Promise<null | string> {
    let user: UserMongo
    try {
      user = await prisma.user.findUnique({ where: { uid: uid } })
      if (user === null) {
        return null
      }
    }
    catch(error) {
      console.log("error user", error)
      return null
    }
    return user.userName
  }

  async getFavorites(uid: string): Promise<string[]> {
    let user: UserMongo
    try {
      user = await prisma.user.findUnique({ where: { uid: uid } })
      if (user === null) {
        return []
      }
    }
    catch(error) {
      console.log("error user", error)
      return null
    }
    return user.favorites
  }

  async signup(userInput: UserInput): Promise<UserMutationResponse> {
    try {
      let userResponse = await prisma.user.create({
        data: {
          ...userInput
        }
      })
      return {
        code: "200",
        success: true,
        message: "New user created!",
        user: { ...userResponse },
      }
    } catch (err) {
      console.log(err)
    }
  }

}

