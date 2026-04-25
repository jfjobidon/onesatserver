import { GetFavoritesQueryResponse, GetVotedQueryResponse, QueryResolvers, UserMutationResponse } from "../__generated__/resolvers-types"

import { DataSourcesRedis } from '../datasourcesredis.js'
const dataSourcesRedis = new DataSourcesRedis()

import { DataSourcesMongo } from "../datasourcesmongo.js"
import { GraphQLError } from "graphql"
const dataSourcesMongo = new DataSourcesMongo()

import { networkInterfaces } from 'os'

const queries: QueryResolvers = {

  placeholder: async (_, __generated__) => {
    return true
  },

  ping: async (_, __) => {
    return { pong: "Pong"}
  },

  // for development, android needs the ip address of the server: localhost or 127.0.0.1 wont work
  getLocalIpAddress: async (_, __) => {
    // const { networkInterfaces } = require('os')

    const nets = networkInterfaces()
    const results = Object.create(null) // Or just '{}', an empty object

    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
          // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
          // 'IPv4' is in Node <= 17, from 18 it's a number 4 or 6
          const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
          if (net.family === familyV4Value && !net.internal) {
              if (!results[name]) {
                  results[name] = []
              }
              results[name].push(net.address)
          }
      }
    }
    console.log("result", results)
    return results.en0[0]
  },

  getUsers: async (_, __, context) => {
    console.table(context)
    console.log(typeof context.roles)
    let users = await dataSourcesMongo.getUsers()
    // if (true) throw new GraphQLError("you must be logged in to query this schema", {
    //   extensions: {
    //     code: 'UNAUTHENTICATED',
    //   },
    // })
    // if (true) throw new GraphQLError('You are not authorized to perform this action.', {
    //   extensions: {
    //     code: 'FORBIDDEN',
    //     argumentName: 'tokenId',
    //     alpha: 'beta'
    //   },
    // })
    // console.table(users)
    return users.map((user) => {
      return { ...user }
    })
  },

  getUserById: async (_, args) => {
    const user = await dataSourcesMongo.getUserById(args.id)
    if (user === null) {
      return null
    }
    return { ...user }
  },

  getUserName: async (_, args) => {
    const userName = await dataSourcesMongo.getUserName(args.uid)
    if (userName === null) {
      return null
    }
    return userName
  },

  getSatsBalance: async (_, args) => {
    return await dataSourcesRedis.getSatsBalance(args.uid)
  },

  getFavorites: async (_, args): Promise<GetFavoritesQueryResponse> => {
    // add/remove elementId in user.isfavorite
    console.log("getFavorites uid: ", args)
    const favoriteResponse = await dataSourcesMongo.getFavorites(args.uid)
    return {
      favorites: favoriteResponse
    }
  },
  
  getVoted: async (_, args): Promise<GetVotedQueryResponse> => {
    // add/remove elementId in user.isfavorite
    // console.log("getVoted uid: ", args)
    const campaignIds = await dataSourcesRedis.getVoted(args.uid)
    return {
      voted: campaignIds
    }
  },

  getCampaigns: async(_, args) => {
    const campaigns = await dataSourcesMongo.getCampaigns(args.uid, args.campaignType)
    return campaigns
  },

  getCampaign: async(_, args) => {
    // TODO: dans dataSourcesMongo, on fait la requete sats, views, votes dans dataSourcesRedis
    //       ces requêtes devraient être faites ici: keep mongo and Redis separated...
    console.log("dans getCampaign...")
    const campaign = await dataSourcesMongo.getCampaign(args.id)
    return campaign
  },

  getCampaignAll: async(_, args, context) => {
    const campaignAll = await dataSourcesMongo.getCampaignAll(args.id, context?.userId)
    return campaignAll
  },

  getCampaignsVoted: async (_, args): Promise<GetVotedQueryResponse> => {
    // Get the array of campaignIds that the user has voted for
    console.log("111111")
    console.log("args.uid", args.uid)
    const campaignIds = await dataSourcesRedis.getVoted(args.uid)
    console.log("22222")
    console.log("getCampaignsVoted", campaignIds)
    console.log("33333")
  
    // Fetch the campaign details for each campaignId
    // const campaigns = await Promise.all(
    //   campaignIds.map(async (campaignId) => {
    //     const campaign = await dataSourcesMongo.getCampaign(campaignId)
    //     return campaign
    //   })
    // )
    // return campaigns
    return {
      voted: ["djskdj"]
    }
    // return [
    //   {
    //     id: "672937cd91e49d47ea72e629",
    //     authorId: "XYW7e7OzM6cueu2SZ1muUNyYDfj1",
    //     title: "Bitcoin Film Festival",
    //     description: "Campaign about BTC film festival",
    //     message: null,
    //     creationDate: Date(),
    //     startingDate: Date(),
    //     endingDate: Date(),
    //     updatedDate: Date(),
    //     minSatPerVote: 1,
    //     maxSatPerVote: 2,
    //     suggestedSatPerVote: 2,
    //     isPrivate: false,
    //     blindAmount: false,
    //     blindRank: false,
    //     allowMultipleVotes: true,
    //     paused: false,
    //     isFavorite: true,
    //     isVoted: true,
    //     sats: 4,
    //     votes: 2,
    //     views: 2,
    //     blindVote: false
    //   }
    // ]
  },

  getUserByUserName: async (_, args) => {
    const user = await dataSourcesMongo.getUserByUserName(args.userName)
    return { ...user }
  },

  getPollOption: async (_, args) => {
    const pollOption = await dataSourcesMongo.getPollOption(args.id)
    return pollOption
  },

  getPoll: async (_, args) => {
    const poll = await dataSourcesMongo.getPoll(args.id)
    return poll
  },

  getPollsForCampaign: async (_, args) => {
    const polls = await dataSourcesMongo.getPollsForCampaign(args.campaignId)
    return polls
  },

  getPollOptionsForPoll: async (_, args) => {
    const pollOptions = await dataSourcesMongo.getPollOptionsForPoll(args.pollId)
    return pollOptions
  },

  getUserByEmail: async (_, args, contextValue) => {
    // console.log("contextValue: ", contextValue.token)
    // TODO: check permissions...
    const user = await dataSourcesMongo.getUserByEmail(args.email)
    return { ...user }
  },

  // login: async (_, { email, password }): Promise<UserMutationResponse> => {
  //   let user = await dataSourcesMongo.getUserByEmail(email)
  //   const token = await jwtUtil.sign()

  //   if (user) {
  //     const match = await bcrypt.compare(password, )  // REVIEW: password encrypté dans le client !!??
  //     if (match) {
  //       return {
  //         code: '200',
  //         success: true,
  //         message: "user successfully logged",
  //         token: token,
  //         user: { ...user, password: "********" }
  //       }
  //     } else {
  //       return {
  //         code: '200',
  //         success: false,
  //         message: "unknown combination email/passwword",
  //         token: null,
  //         user: null
  //       }
  //     }
  //   } else {
  //     return {
  //       code: '200',
  //       success: false,
  //       message: "unknown combination email/passwword",
  //       token: null,
  //       user: null
  //     }
  //   }
  // },

  getVotesForCampaign: async (_, {campaignId, uid}) => {
    // console.log("getVotesForCampaign from client")
    return await dataSourcesRedis.getVotesForCampaign(campaignId, uid)
  },

  getUserVotesForCampaign: async (_, {campaignId, uid}) => {
    return dataSourcesRedis.getUserVotesForCampaign(campaignId, uid)
  },
  
  getVotesForPoll: async (_, {pollId, uid}) => {
    return await dataSourcesRedis.getVotesForPoll(pollId, uid)
  },
  
  getVotesForPollOption: async (_, {pollOptionId}) => {
    // console.log("getVotesForPollOption from client")
    return await dataSourcesRedis.getVotesForPollOption(pollOptionId)
  },
  
  getVotesForUser: async (_, args) => {
    console.log("getVotesForUser from client")
    return await dataSourcesRedis.getVotesForUser(args.uid)
  },

  getVoteById: async (_, args) => {
    return dataSourcesRedis.getVoteById(args.id)
  },
}

export default queries
