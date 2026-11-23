export interface CustomerWalletBalance {
  actorId: string;
  currency: "YER";
  balanceYer: string;
}
export interface CustomerFundingTransaction {
  fundingId: string;
  amountYer: string;
  postedAt: string;
  reversesFundingId?: string;
}
export interface CustomerFundingHistory {
  actorId: string;
  currency: "YER";
  items: CustomerFundingTransaction[];
  hasMore: boolean;
  nextCursor: string | null;
}
