// Core
export { PacificaClient, type PacificaClientConfig } from "./client.js";
export { PacificaWSClient, type PacificaWSConfig } from "./ws-client.js";

// Signing
export {
  sortJsonKeys,
  prepareMessage,
  createHeader,
  signWithWallet,
  buildSignedRequest,
  buildAgentSignedRequest,
} from "./signing.js";

// Deposit
export { buildDepositInstruction, deposit } from "./deposit.js";

// Constants
export * from "./constants.js";

// Types
export * from "./types/index.js";
