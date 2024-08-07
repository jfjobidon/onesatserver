import { Schema } from 'redis-om';

// REVIEW: fusionner satsPollOptionSchema, satsPollSchema et satsCampaignSchema dans satsSchema ?
// REVIEW: même question pour votes et views

// Valid types are: string, number, boolean, string[], number[], date, point, and text
// number[] is only possible when working with JSON
// export const voteSchema = new Schema('vote', {
export const voteSchema = new Schema('vote', {
  userID: { type: 'string' },
  voteCode: { type: 'string'},
  invoice: { type: 'string' },
  date: { type: 'string' },
  campaignID: { type: 'string'},
  pollID: { type: 'string'},
  pollOptionID: { type: 'string'},
  certified: { type: 'boolean' },
  sats: { type: 'number' }
  // songDurations: { type: 'number[]' } only valid for JSON !!!
}, {
  dataStructure: 'HASH'
})

export const satsCampaignSchema = new Schema('satsCampaign', {
  campaignID: { type: 'string' },
  totalSats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const satsPollSchema = new Schema('satsPoll', {
  pollID: { type: 'string' },
  totalSats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const satsPollOptionSchema = new Schema('satsPollOption', {
  pollOptionID: { type: 'string' },
  totalSats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const votesCampaignSchema = new Schema('votesCampaign', {
  campaignID: { type: 'string' },
  totalSats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const votesPollSchema = new Schema('votesPoll', {
  pollID: { type: 'string' },
  totalSats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const votesPollOptionSchema = new Schema('votesPollOption', {
  pollOptionID: { type: 'string' },
  totalSats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const viewsCampaignSchema = new Schema('viewsCampaign', {
  campaignID: { type: 'string' },
  totalSats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const viewsPollSchema = new Schema('viewsPoll', {
  pollID: { type: 'string' },
  totalSats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const viewsPollOptionSchema = new Schema('viewsPollOption', {
  pollOptionID: { type: 'string' },
  totalSats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})

export const satsUserSchema = new Schema('satsUser', {
  userID: { type: 'string' },
  sats: { type: 'number' }
}, {
  dataStructure: 'HASH'
})