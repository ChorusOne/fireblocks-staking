import {
  PeerType,
  TransactionOperation,
  type TransactionArguments,
  type SignedMessageResponse,
  TransactionStatus,
  type VaultAccountResponse
} from 'fireblocks-sdk'
import {
  coin, type Coin,
  type MsgDelegateEncodeObject,
  type MsgUndelegateEncodeObject,
  type AminoConverters,
  AminoTypes,
  createStakingAminoConverters,
  createAuthzAminoConverters,
  createBankAminoConverters,
  createDistributionAminoConverters,
  createGovAminoConverters,
  createIbcAminoConverters,
  createVestingAminoConverters,
  defaultRegistryTypes
} from '@cosmjs/stargate'
import { print } from './util'
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { fromBase64, toBase64 } from '@cosmjs/encoding'
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing'
import { MsgDelegate } from 'cosmjs-types/cosmos/staking/v1beta1/tx'
import { Int53 } from '@cosmjs/math'
import { type Config, type Signer } from './types'
import { Sha256 } from '@cosmjs/crypto'

import {
  Registry,
  type TxBodyEncodeObject,
  encodePubkey,
  makeAuthInfoBytes
} from '@cosmjs/proto-signing'

import {
  makeSignDoc as makeSignDocAmino,
  type StdFee,
  type StdSignDoc,
  serializeSignDoc,
  encodeSecp256k1Pubkey,
  encodeSecp256k1Signature
} from '@cosmjs/amino'

function createDefaultTypes (): AminoConverters {
  return {
    ...createAuthzAminoConverters(),
    ...createBankAminoConverters(),
    ...createDistributionAminoConverters(),
    ...createGovAminoConverters(),
    ...createStakingAminoConverters(),
    ...createIbcAminoConverters(),
    ...createVestingAminoConverters()
  }
}

function toCoin (amount: string, expectedDenom: string): Coin {
  const total: string | undefined = amount.match(/\d+/)?.at(0)
  const denom: string | undefined = amount.match(/[^\d.-]+/)?.at(0)

  if (total === undefined || denom === undefined) {
    throw Error('failed to extract denom and total amount of tokens from: ' + amount)
  }

  if (denom !== expectedDenom) {
    throw new Error(
      'denom mismatch, expected: ' + expectedDenom + ' got: ' + denom
    )
  }

  return coin(total, denom)
}

export async function genSignableTx (
  config: Config,
  msgType: string,
  chainID: string,
  amount: string,
  accountNumber: number,
  accountSequence: number
): Promise<StdSignDoc> {
  const aminoTypes = new AminoTypes(createDefaultTypes())

  const coins = toCoin(amount, config.network.denom)

  if (!['delegate', 'undelegate'].some((x) => x === msgType)) {
    throw new Error('invalid type: ' + msgType)
  }

  const delegateMsg: MsgDelegateEncodeObject | MsgUndelegateEncodeObject = {
    typeUrl:
            msgType === 'delegate'
              ? '/cosmos.staking.v1beta1.MsgDelegate'
              : '/cosmos.staking.v1beta1.MsgUndelegate',
    value: MsgDelegate.fromPartial({
      delegatorAddress: config.delegatorAddress,
      validatorAddress: config.validatorAddress,
      amount: coins
    })
  }

  const feeAmt: bigint =
        config.network.fee ?? config.network.gasPrice * config.network.gas
  const fee: StdFee = {
    amount: [coin(feeAmt.toString(), config.network.denom)],
    gas: config.network.gas.toString()
  }

  const signDoc = makeSignDocAmino(
    [delegateMsg].map((msg) => aminoTypes.toAmino(msg)),
    fee,
    chainID,
    '', // memo
    accountNumber,
    accountSequence
  )

  return signDoc
}

export async function genSignedMsg (
  fireblocksClient: Signer,
  signDoc: StdSignDoc,
  vault: VaultAccountResponse,
  delegatorAddress: string,
  assetId: string
): Promise<SignedMessageResponse> {
  const msg = new Sha256(serializeSignDoc(signDoc)).digest()
  const hexMsg = Buffer.from(msg).toString('hex')

  const args: TransactionArguments = {
    assetId,
    source: {
      type: PeerType.VAULT_ACCOUNT,
      id: vault.id,
      address: delegatorAddress
    },
    operation: TransactionOperation.RAW,
    extraParameters: {
      rawMessageData: {
        messages: [
          {
            content: hexMsg
          }
        ]
      }
    }
  }

  // https://developers.fireblocks.com/docs/raw-message-signing
  print(2, 3, 'wait for the TX signature from the remote signer')
  let { status, id } = await fireblocksClient.createTransaction(args)

  let txInfo = await fireblocksClient.getTransactionById(id)
  status = txInfo.status

  const states = [
    TransactionStatus.COMPLETED,
    TransactionStatus.FAILED,
    TransactionStatus.BLOCKED
  ]

  while (!states.some((x) => x === status)) {
    try {
      console.log(`* signer request ID: ${id} with status: ${status}`)
      txInfo = await fireblocksClient.getTransactionById(id)

      status = txInfo.status
    } catch (err) {
      console.error('probing remote signer failed', err)
    }

    await new Promise((resolve, reject) => setTimeout(resolve, 1000))
  }

  const details = txInfo.subStatus === '' ? 'none' : txInfo.subStatus
  console.log(
    `* signer request ID finished with status ${status}; details: ${details}`
  )

  if (txInfo.signedMessages === undefined || txInfo.signedMessages?.length === 0) {
    throw new Error("fireblocks didn't return any signed message, but it should")
  }

  return txInfo.signedMessages[0]
}

export async function genSignedTx (
  signDoc: StdSignDoc,
  signedMsg: SignedMessageResponse
): Promise<[TxRaw, string]> {
  const signMode = SignMode.SIGN_MODE_LEGACY_AMINO_JSON

  // cosmos signature doesn't use `v` field, only .r and .s
  const signatureBytes = new Uint8Array([
    ...Buffer.from(signedMsg.signature.r ?? '', 'hex'),
    ...Buffer.from(signedMsg.signature.s ?? '', 'hex')
  ])

  const pk = Buffer.from(signedMsg.publicKey, 'hex')
  const pubkey = encodePubkey(encodeSecp256k1Pubkey(pk))

  // https://github.com/cosmos/cosmjs/blob/main/packages/stargate/src/signingstargateclient.ts#L331
  const aminoTypes = new AminoTypes(createDefaultTypes())
  const signedTxBody = {
    messages: signDoc.msgs.map((msg) => aminoTypes.fromAmino(msg)),
    memo: signDoc.memo
  }

  const signedTxBodyEncodeObject: TxBodyEncodeObject = {
    typeUrl: '/cosmos.tx.v1beta1.TxBody',
    value: signedTxBody
  }

  const registry = new Registry(defaultRegistryTypes)
  const signedTxBodyBytes = registry.encode(signedTxBodyEncodeObject)

  const signedGasLimit = Int53.fromString(signDoc.fee.gas).toNumber()
  const signedSequence = Int53.fromString(signDoc.sequence).toNumber()

  const signedAuthInfoBytes = makeAuthInfoBytes(
    [{ pubkey, sequence: signedSequence }],
    signDoc.fee.amount,
    signedGasLimit,
    signDoc.fee.granter,
    signDoc.fee.payer,
    signMode
  )

  const cosmosSignature = encodeSecp256k1Signature(pk, signatureBytes)

  const txRaw = TxRaw.fromPartial({
    bodyBytes: signedTxBodyBytes,
    authInfoBytes: signedAuthInfoBytes,
    signatures: [fromBase64(cosmosSignature.signature)]
  })

  return [txRaw, toBase64(pk)]
}
