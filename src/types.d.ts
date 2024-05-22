import type {
  PagedVaultAccountsRequestFilters,
  PagedVaultAccountsResponse,
  TransactionArguments,
  RequestOptions,
  CreateTransactionResponse,
  TransactionResponse,
  PublicKeyInfoForVaultAccountArgs,
  PublicKeyResponse,
  DepositAddressResponse
} from 'fireblocks-sdk'

import type { NetworkType, RewardDestination } from './enums'

export interface Config {
  // define validator address to interact with (delegate, undelegate etc)
  validatorAddress: string

  // define the expected delegator account
  delegatorAddress: string

  // use fireblocks as signer
  fireblocks: FireblocksConfig

  // use local signer (used for testing)
  localsigner: LocalSigner

  // the network type to interact with
  networkType: NetworkType

  // network specific configuration
  cosmos?: CosmosNetworkConfig
  near?: NearNetworkConfig
  substrate?: SubstrateNetworkConfig
}

export interface FireblocksConfig {
  // the path to API RSA key
  apiSecretKeyPath: string

  // the path to file with API KEY
  apiKeyPath: string

  // fireblocks vault name e.g. 'celestia-wallet'
  vaultName: string

  // e.g. CELESTIA or CELESTIA_TEST
  assetId: string
}

export interface NearNetworkConfig {
  networkId: string
  nodeUrl: string
  walletUrl: string
  helperUrl: string
  explorerUrl: string
}

export interface CosmosNetworkConfig {
  // e.g. https://celestia.chorus.one:443 - the :port is required
  rpcUrl: string

  // address prefix e.g. celestia
  bechPrefix: string

  // coin denom e.g utia
  denom: string

  // default TX gas e.g 200000
  gas: bigint

  // gas price e.g 0.4
  // https://github.com/cosmos/chain-registry/blob/master/celestia/chain.json
  gasPrice: bigint

  // fixed fee paid for TX - this will override the gasPrice * gas = fee
  // calculation
  fee?: bigint

  // block explorer URL to display Transaction ID via Web UI. Example:
  //   https://mintscan.io/celestia/tx/
  //   https://celestia.explorers.guru/transaction/
  blockExplorerUrl?: string
}

export interface SubstrateNetworkConfig {
  // e.g. wss://rpc.polkadot.io
  rpcUrl: string

  // block explorer URL to display Transaction ID via Web UI. Example:
  // * https://westend.subscan.io/account
  blockExplorerUrl: string

  // the input amount of tokens is multiplied by this value to get the amount
  // in the smallest unit of the token. e.g.
  //  * 1000000000000 for testnet
  //  * 10000000000 for mainnet
  denomMultiplier: number

  // Stash or Controller (likely u want Stash)
  rewardDestination: RewardDestination
}

export interface LocalSigner {
  // a file containing delegator mnemonic
  mnemonicPath: string
}

export interface SignerBackend {
  getVaultAccountsWithPageInfo: (
    pagedVaultAccountsRequestFilters: PagedVaultAccountsRequestFilters,
  ) => Promise<PagedVaultAccountsResponse>

  createTransaction: (
    transactionArguments: TransactionArguments,
    requestOptions?: RequestOptions,
  ) => Promise<CreateTransactionResponse>

  getTransactionById: (txId: string) => Promise<TransactionResponse>

  getPublicKeyInfoForVaultAccount: (args: PublicKeyInfoForVaultAccountArgs) => Promise<PublicKeyResponse>

  getDepositAddresses: (vaultAccountId: string, assetId: string) => Promise<DepositAddressResponse[]>
}

export interface Journal {
  entries: JournalEntry[]
}

export interface JournalEntry {
  type: string
  timestamp: number
  data: any
}
