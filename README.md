# Fireblocks Staking CLI
The Fireblocks Staking CLI is a tool designed to simplify the process of staking (or unstaking) tokens on cosmos-sdk based networks such as Celestia and others.

## How does it work?
The CLI utilizes the [Fireblocks API](https://developers.fireblocks.com/docs/api-sdk-overview) to sign a blockchain compatible transaction. Here's a brief overview of the signing flow:

1. The CLI parses the configuration file (`config.json`) to gather necessary information such as delegator and validator accounts, gas price etc.
2. The CLI calls the remote blockchain RPC endpoint to fetch data about the delegator account.
3. The CLI calls the Fireblocks API to retrieve [Vault Account](https://developers.fireblocks.com/docs/creating-vaults-and-wallets#overview) information.
4. Based on the RPC response and configuration, the CLI builds an unsigned transaction and prompts the user to approve its signing.
5. Upon user approval, the CLI sends the unsigned transaction to the Fireblocks remote endpoint for signing using the [Fireblocks Raw Message Signing](https://developers.fireblocks.com/docs/raw-message-signing) feature, authenticated with the access credentials specified in the configuration file.
6. Once the signing response is received, the CLI crafts a blockchain compatible signed transaction using the response data (Public Key and Signature).
7. The signed transaction is displayed on the screen, and the user is prompted to broadcast the transaction to the network (if the `--broadcast` flag was set).
8. Upon user approval, the transaction is broadcasted through the blockchain RPC, and the transaction details are printed on the screen.

In addition to the above, the signed and unsigned transactions are stored in `journal.log` for troubleshooting purposes.

NOTE: it is recommended to remove the `journal.log` once the intended transactions are executed. To disable journal use `--journal false`

## Prerequisites
Before using the CLI, you need to set up a Fireblocks API account. You can refer to the [Fireblocks API documentation](https://developers.fireblocks.com/docs/quickstart#api-user-creation) for instructions on how to create an API account.

You should also have two files on your local disk:
- `fireblocks_api_key`: This file contains the API key in the format `<hex>-<hex>-<hex>-<hex>-<hex>`.
- `fireblocks_secret_key`: This file contains the private key from CSR generation process. The content of this file likely starts with `-----BEGIN PRIVATE KEY-----`.

## Installation
To install the necessary dependencies, run the following command using [npm](https://www.npmjs.com):
```
$ npm install
```

## Configuration
Proper configuration is crucial for the tool to function correctly. You should ensure that your configuration file (`config.json`) is accurate. An example configuration can be found in `config.example.json`.

The most important fields in the configuration are the addresses:
- `validatorAddress`: This is the address of the validator account you want to interact with (delegate, undelegate, etc.).
- `delegatorAddress`: This is the address of your Fireblocks custodied account. You will delegate from this account to the validator account.

In the configuration, you will also find the `fireblocks` and `localsigner` sections. The `localsigner` section is only used for local testing, so you should only specify the `fireblocks` section:
```
fireblocks: {
    ...
}
```

The configuration is specific to the blockchain network you are using. This configuration will vary for networks like Celestia, dYdX, Cosmos Hub, etc.

### Cosmos
Here's an example configuration for Celestia:
```
"cosmos": {
  "rpcUrl": "https://celestia.chorus.one:443",
  "bechPrefix": "celestia",
  "denom": "utia",
  "gas": 200000,
  "gasPrice": 0.4
}
```

- `rpcUrl`: This specifies the node to connect to.
- `bechPrefix`: This is the cosmos-sdk address prefix. You can find it in your address, such as `celestia...`.
- `denom`: This is the lowest coin denominator for the network. In Celestia, it is `utia`, where `1000000utia` is equal to `1 TIA`. The `u` prefix represents `10^6`.
- `gas`: This defines the gas limit for the transaction.
- `gasPrice`: This specifies the gas price for the transaction.

For a better understanding of `gas` and `gasPrice`, please refer to the [cosmos-sdk documentation](https://docs.cosmos.network/main/learn/beginner/gas-fees). The most important thing to remember is the formula to calculate transaction fees:
```
fee = gas * gasPrice
```

All amounts specified in the transaction must be expressed in the `denom` (e.g., `utia` for Celestia).

If you are unsure about any of the configuration parameters, you can check the `src/types.d.ts` file and refer to the comments for clarification.

### NEAR
Here's an example configuration for NEAR mainnet:
```
"near": {
    "networkId": "mainnet",
    "nodeUrl": "https://rpc.near.org",
    "walletUrl": "https://wallet.near.org",
    "helperUrl": "https://helper.near.org",
    "explorerUrl": "https://nearblocks.io/txns/"
}
```

### Avalanche
Here's an example configuration for Avalanche mainnet:
```
"avalanche": {
    "rpcUrl": "https://api.avax.network",
    "denomMultiplier": 1000000000,
    "blockExplorerUrl": "https://avascan.info/blockchain"
}
```

### Substrate (Polkadot, Kusama, ...)
Here's and example configuration for Polkadot testnet (Westend):
```
"substrate": {
    "rpcUrl": "wss://westend.public.curie.radiumblock.co/ws",
    "denomMultiplier": 1000000000000,
    "rewardDestination": "Stash",
    "blockExplorerUrl": "https://westend.subscan.io/account"
}
```

Please note that staking in Substrate networks requires multiple transactions. This is:
1. `bond` - to bond the initial amount of tokens (use `bond-extra` if you wish to stake more tokens but you already run `bond`)
2. `nominate` - nominates the stake to a validator address present in the config

## Usage
Please note that unless you pass the `--broadcast` flag, your transaction will not be sent to the network. Signing a transaction and broadcasting it are two separate actions. Therefore, having a signed transaction does not affect your account unless it is broadcasted and processed by the network.

To delegate your funds (e.g., `1000000utia`), execute the following command:
```
npm run fireblocks-staking -- cosmos tx delegate <amount> --broadcast
```

To unbond funds, use the following command:
```
npm run fireblocks-staking -- cosmos tx unbond <amount> --broadcast
```

As mentioned in the "How does it work?" section, the CLI is interactive. It will prompt you before signing a transaction and broadcasting it, allowing you time to review its contents.

### How to interpret Raw Transaction?
Cosmos SDK based chains use a JSON structured format. Unlike Ethereum, the cosmos-sdk transactions are human readable and easy to understand where as for Ethereum you are forced to `blind sign` a stream of bytes everytime you interact with a contract.

Here's an example of a delegate transaction printed by the CLI:
```
{
  "chain_id": "mocha-4",
  "account_number": "73557",
  "sequence": "7",
  "fee": {
    "amount": [
      {
        "amount": "80000",
        "denom": "utia"
      }
    ],
    "gas": "200000"
  },
  "msgs": [
    {
      "type": "cosmos-sdk/MsgDelegate",
      "value": {
        "delegator_address": "celestia163l3w3m8nmgyq08helyvjq6tnpktr265tqljkn",
        "validator_address": "celestiavaloper1ksqfc6445yq82n3p28utpt500fyddrtlezx3pp",
        "amount": {
          "denom": "utia",
          "amount": "100"
        }
      }
    }
  ],
  "memo": ""
}
```

As you can see, the message type is `MsgDelegate`, and the contents specify the delegator and validator addresses, as well as the amount of tokens to be delegated.
Always check the messages included in your transaction, the amount, addresses, and the fee (which should be minimal and cost no more than `1000000utia` = `1 TIA`). Any amount specified in the fee is distributed among the validators, therefore ensure the amount is acceptable.

## Security
There are a few security measures you should take into account:
1. Do not share your Fireblocks API authentication keys with anyone.
2. Ensure that you have a proper [Transaction Authorization Policy](https://developers.fireblocks.com/docs/capabilities#transaction-authorization-policy-tap) in place. Access to a given vault should be limited for the API account.
3. Always review the transaction contents before signing.

## License
This program is provided under the terms of the MIT license. See the `LICENSE` file for more information.
