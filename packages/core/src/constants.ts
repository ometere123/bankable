// Fixed facts from the specification (section 4.2). Each is re-verified by the gates against live chain data.
export const QIE_MAINNET_CHAIN_ID = 1990n;
export const QUSDC_ADDRESS = "0x3f43da82ec9a4f5285f10faf1f26eca7319e5da5"; // lowercase canonical form
export const QUSDC_DECIMALS = 6;
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 = "0x" + "0".repeat(64);
/** Measured at G1: the QIE endpoints reject eth_getLogs spans above 10,000 blocks. */
export const MAX_LOG_SPAN = 10_000;
/** Measured at G1: QUSDC deployment block on QIE mainnet (code absent at N-1, present at N). */
export const QUSDC_DEPLOYMENT_BLOCK = 5_244_996;
export const MAX_PDF_BYTES = 2 * 1024 * 1024;
/** ~545 bytes per entry measured at G2 (600 entries = 327 KB); 2000 entries ~ 1.1 MB, safely under MAX_PDF_BYTES. */
export const MAX_ENTRIES = 2_000;
