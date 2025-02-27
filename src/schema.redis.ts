import { Schema } from 'redis-om';

// REVIEW: fusionner satsPollOptionSchema, satsPollSchema et satsCampaignSchema dans satsSchema ?
// REVIEW: même question pour votes et views

// Valid types are: string, number, boolean, string[], number[], date, point, and text
// number[] is only possible when working with JSON
// export const voteSchema = new Schema('vote', {
export const voteSchema = new Schema('vote', {
  uid: { type: 'string' },
  voteCode: { type: 'string'},
  invoice: { type: 'string' },
  date: { type: 'string' },
  campaignId: { type: 'string'},
  pollId: { type: 'string'},
  pollOptionId: { type: 'string'},
  certified: { type: 'boolean' },
  sats: { type: 'number' }
  // songDurations: { type: 'number[]' } only valid for JSON !!!
}, {
  dataStructure: 'HASH'
})

export const activitySchema = new Schema('activity', {
  type: { type: 'string' },
  uid: { type: 'string' },
  description: { type: 'string' },
  date: { type: 'string' }
}, {
  dataStructure: 'HASH'
})

export const userVotedSchema = new Schema('userVoted', {
  uid: { type: 'string' },
  campaignIds: { type: 'string[]', path: '$.userVoted.campaignIds[*]' }
}, {
  dataStructure: 'HASH'
})

export const satsCampaignSchema = new Schema('satsCampaign', {
  campaignId: { type: 'string' },
  sats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const satsPollSchema = new Schema('satsPoll', {
  pollId: { type: 'string' },
  sats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const satsPollOptionSchema = new Schema('satsPollOption', {
  pollOptionId: { type: 'string' },
  sats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const votesCampaignSchema = new Schema('votesCampaign', {
  campaignId: { type: 'string' },
  sats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const votesPollSchema = new Schema('votesPoll', {
  pollId: { type: 'string' },
  sats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const votesPollOptionSchema = new Schema('votesPollOption', {
  pollOptionId: { type: 'string' },
  sats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const viewsCampaignSchema = new Schema('viewsCampaign', {
  campaignId: { type: 'string' },
  sats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const viewsPollSchema = new Schema('viewsPoll', {
  pollId: { type: 'string' },
  sats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const viewsPollOptionSchema = new Schema('viewsPollOption', {
  pollOptionId: { type: 'string' },
  sats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const satsUserSchema = new Schema('satsUser', {
  uid: { type: 'string' },
  sats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})