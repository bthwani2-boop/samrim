// Compatibility surface: DSH alone owns Captain-standing HTTP and DTO validation.

export type { CaptainStanding } from "@bthwani/dsh";
export {
  CaptainStandingError, captainStandingFrom, readApprovedCaptainStanding,
  readCaptainApplication, requestCaptainApplication,
} from "@bthwani/dsh";
