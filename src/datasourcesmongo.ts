import config from "config";

// // for type safety in our data source class
// // import { objectEnumValues } from "@prisma/client/runtime/library";
import { User, UserInput, UserMutationResponse, CampaignMutationResponse, CampaignInput, PollInput, PollMutationResponse  } from "./__generated__/resolvers-types";

// // const UsersDB: Omit<Required<User>, "__typename">[] = usersData;

const minSatPerVoteDefault = config.get<string>('minSatPerVoteDefault') 
const maxSatPerVoteDefault = config.get<string>('maxSatPerVoteDefault') 
const suggestedSatPerVoteDefault = config.get<string>('suggestedSatPerVoteDefault') 
const campaignPausedDefault = config.get<string>('campaignPausedDefault') 
const blindAmountDefault = config.get<string>('blindAmount') 
const blindRankDefault = config.get<string>('blindRank') 
const allowMultipleVotesDefault = config.get<string>('allowMultipleVotes') 
console.log("minSatPerVoteDefault " + minSatPerVoteDefault)
console.log("maxSatPerVoteDefault " + maxSatPerVoteDefault)
console.log("suggestedSatPerVoteDefault " + suggestedSatPerVoteDefault)
console.log("campaignPausedDefault " + campaignPausedDefault)
console.log("blindAmountDefault " + blindAmountDefault)
console.log("blindRankDefault " + blindRankDefault)
console.log("allowMultipleVotesDefault " + allowMultipleVotesDefault)

import { PrismaClient } from '@prisma/client'
// import { commandOptions } from "redis";
// import { clearScreenDown } from "readline";
const prisma = new PrismaClient()

export class DataSourcesMongo {

  async getUsers(): Promise<User[]> {
    // console.log("getUsers: prisma findMany")
    const users = await prisma.user.findMany({})
    console.table(users)
    return users;
  }

  async getUserByName(name: string): Promise<User> {
    console.log("in getUserByName")
    console.log(name)
    const user = prisma.user.findUnique({ where: { name: name } });
    // return user;
    return null;
  }

  async getUserByEmail(email: string): Promise<User> {
    console.log("in getUserByEmail")
    console.log(email)
    const user = await prisma.user.findUnique({ where: { email: email } });
    console.log("date user: " + user.creationDate)
    return user;
    // return null;
  }

  // async createCampaign(authorId: string, campaign: CampaignInput): Promise<CampaignMutationResponse> {
  async createCampaign(authorId: string, campaignInput: CampaignInput): Promise<CampaignMutationResponse> {
    console.table(campaignInput)
    const minSatPerVote = campaignInput.minSatPerVote || minSatPerVoteDefault;
    const maxSatPerVote = campaignInput.maxSatPerVote || maxSatPerVoteDefault;
    const suggestedSatPerVote = campaignInput.suggestedSatPerVote || suggestedSatPerVoteDefault;
    const blindAmount = campaignInput.blindAmount || blindAmountDefault;
    const blindRank = campaignInput.blindRank || blindRankDefault;
    const allowMultipleVotes = campaignInput.allowMultipleVotes || allowMultipleVotesDefault;
    const creationDate = new Date()
    const startingDate = new Date(campaignInput.startingDate)
    const endingDate = new Date(campaignInput.endingDate)
    // console.log("startingDate: " + startingDate)
    // console.log("creationDate: " + creationDate)
    
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
          id: authorId,
        },
        data: {
          campaigns: {
            // create: campaignInput
            // create: { ...campaignInput, creationDate: isodate },
            // create: { ...campaignInput, creationDate: Date() },
            createMany: {
              data: [
                {
                  ...campaignInput,
                  minSatPerVote: minSatPerVote,
                  maxSatPerVote: maxSatPerVote,
                  suggestedSatPerVote: suggestedSatPerVote,
                  totalSat: 0,
                  creationDate: creationDate,
                  updatedDate: creationDate,
                  startingDate: startingDate,
                  endingDate: endingDate,
                  paused: campaignPausedDefault,
                  blindAmount: blindAmount,
                  blindRank: blindRank,
                  allowMultipleVotes: allowMultipleVotes
                }
              ],
              // data: [{...campaignInput, creationDate: Date()}],
              // data: [{...campaignInput}],
              // data: [{...campaignInput, creationDate: "2023-10-23T19:13:38.357+00:00"}],
              // data: [{...campaignInput, creationDate: new Date(isodate)}],
              // data: [{...campaignInput, creationDate: (new Date()).toISOString()}],
              // data: [{ title: 'My first post' }, { title: 'My second post' }],
            },
          },
        },
        include: {
          campaigns: true
        },
      })
      // console.table(result)
      // console.table(result.campaigns)
      return {
        code: "200",
        success: true,
        message: "Campaign created!",
        // campaign: result.campaigns[1]
        campaign: {
          authorId: authorId,
          title: campaignInput.title,
          question: campaignInput.question,
          description: campaignInput.description,
          startingDate: startingDate,
          endingDate: endingDate,
          message: null,
          minSatPerVote: minSatPerVote,
          maxSatPerVote: maxSatPerVote,
          suggestedSatPerVote: suggestedSatPerVote,
          totalSat: 0,
          paused: campaignPausedDefault,
          blindAmount: blindAmount,
          blindRank: blindRank,
          allowMultipleVotes: allowMultipleVotes,
          // creationDate: result.campaigns[1].creationDate
          creationDate: creationDate,
          updatedDate: creationDate
        },
      }
      // const result = await prisma.user.update({
      //   where: {
      //     id: authorId,
      //   },
      //   data: {
      //     campaigns: {
      //       createMany: {
      //         data: [{...campaignInput, creationDate: new Date} ],
      //       },
      //     },
      //   },
      //   include: {
      //     campaigns: true,
      //   }
      // })
      // console.log(result)
      // return {
      //   code: "200",
      //   success: true,
      //   message: "Campaign created!",
      //   campaign: {
      //     title: campaignInput.title,
      //     authorId: authorId,
      //     // creationDate: result.campaigns[1].creationDate
      //     creationDate: new Date()
      //   },
      // }
    } catch (err) {
      console.log(err)
    }
  }

  async createPoll(authorId: String, pollInput: PollInput): Promise<PollMutationResponse> {
    const campaignId = pollInput.campaignId;
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
                  title: pollInput.title
                }
              ]
            }
          }
        },
        include: {
          polls: true
        }
      })
      return {
        code: "200",
        success: true,
        message: "poll created!",
        poll: {
          // authorId: authorId,
          campaignId: campaignId,
          title: pollInput.title,
        },
      }
    } catch (err) {
      console.log(err)
    }
  } 

  async getUserById(id: string): Promise<User> {
    console.log("in getUser")
    console.log(id)
    const user = prisma.user.findUnique({ where: { id: id } });
    // const user = prisma.user.findUnique({where: {id: "651efe317ef84f6cd52a4476"}});
    // const user = prisma.user.findUnique({where: {name: name}});
    // return user;
    return null;
  }

  async signup(userInput: UserInput): Promise<UserMutationResponse> {
    // await prisma.user.create({
    //   data: user,
    // }).then((userx) => {
    //   return {
    //     code: "200",
    //     success: true,
    //     message: "New user created!",
    //     user: { ...userx, password: "********" },
    //   }
    // })

    let user = await prisma.user.create({
      data: userInput,
    })
    return {
      code: "200",
      success: true,
      message: "New user created!",
      user: { ...user, password: "********" },
    }

    // return {
    //   code: "200",
    //   success: true,
    //   message: "New user created!",
    //   user: { ...user, password: "********" },
    // }
    // } else {
    //   return {
    //     code: "400",
    //     success: false,
    //     message: "Invalid input",
    //     user: null,
    //   };
    // }
  }

}

