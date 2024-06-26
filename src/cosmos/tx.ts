import type {
  SignedMessageResponse,
  VaultAccountResponse
} from 'fireblocks-sdk'
import {
  coin,
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
import type {
  Coin,
  MsgDelegateEncodeObject,
  MsgUndelegateEncodeObject,
  MsgBeginRedelegateEncodeObject,
  MsgWithdrawDelegatorRewardEncodeObject,
  AminoConverters
} from '@cosmjs/stargate'
import type { Signer } from '../signer'
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { fromBase64, toBase64 } from '@cosmjs/encoding'
import { SignMode } from 'cosmjs-types/cosmos/tx/signing/v1beta1/signing'
import { MsgBeginRedelegate, MsgDelegate } from 'cosmjs-types/cosmos/staking/v1beta1/tx'
import { MsgWithdrawDelegatorReward } from 'cosmjs-types/cosmos/distribution/v1beta1/tx'
import { Int53 } from '@cosmjs/math'
import type { CosmosNetworkConfig, Config } from '../types'
import { Sha256 } from '@cosmjs/crypto'
import { getNetworkConfig } from '../util'

import {
  Registry,
  encodePubkey,
  makeAuthInfoBytes
} from '@cosmjs/proto-signing'
import type {
  TxBodyEncodeObject,
  EncodeObject
} from '@cosmjs/proto-signing'

import {
  makeSignDoc as makeSignDocAmino,
  serializeSignDoc,
  encodeSecp256k1Pubkey,
  encodeSecp256k1Signature
} from '@cosmjs/amino'
import type { StdFee, StdSignDoc } from '@cosmjs/amino'

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

export function genWithdrawRewardsMsg (
  config: Config,
  validatorAddress: string
): MsgWithdrawDelegatorRewardEncodeObject {
  const withdrawRewardsMsg: MsgWithdrawDelegatorRewardEncodeObject = {
    typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
    value: MsgWithdrawDelegatorReward.fromPartial({
      delegatorAddress: config.delegatorAddress,
      validatorAddress: validatorAddress ?? config.validatorAddress
    })
  }

  return withdrawRewardsMsg
}

export function genDelegateOrUndelegateMsg (
  config: Config,
  msgType: string,
  amount: string
): MsgDelegateEncodeObject | MsgUndelegateEncodeObject {
  const networkConfig = getNetworkConfig<CosmosNetworkConfig>(config)
  const coins = toCoin(amount, networkConfig.denom)

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

  return delegateMsg
}

export function genBeginRedelegateMsg (
  config: Config,
  amount: string,
  validatorDstAddress: string
): MsgBeginRedelegateEncodeObject {
  const networkConfig = getNetworkConfig<CosmosNetworkConfig>(config)
  const coins = toCoin(amount, networkConfig.denom)

  const beginRedelegateMsg: MsgBeginRedelegateEncodeObject = {
    typeUrl: '/cosmos.staking.v1beta1.MsgBeginRedelegate',
    value: MsgBeginRedelegate.fromPartial({
      delegatorAddress: config.delegatorAddress,
      validatorSrcAddress: config.validatorAddress,
      validatorDstAddress,
      amount: coins
    })
  }

  return beginRedelegateMsg
}

export async function genSignableTx (
  networkConfig: CosmosNetworkConfig,
  chainID: string,
  msg: EncodeObject,
  accountNumber: number,
  accountSequence: number,
  memo?: string
): Promise<StdSignDoc> {
  const aminoTypes = new AminoTypes(createDefaultTypes())

  const feeAmt: bigint =
        networkConfig.fee ?? networkConfig.gasPrice * networkConfig.gas
  const fee: StdFee = {
    amount: [coin(feeAmt.toString(), networkConfig.denom)],
    gas: networkConfig.gas.toString()
  }

  const signDoc = makeSignDocAmino(
    [msg].map((msg) => aminoTypes.toAmino(msg)),
    fee,
    chainID,
    memo,
    accountNumber,
    accountSequence
  )

  return signDoc
}

export async function genSignedMsg (
  signer: Signer,
  signDoc: StdSignDoc,
  vault: VaultAccountResponse,
  delegatorAddress: string,
  assetId: string
): Promise<SignedMessageResponse> {
  const msg = new Sha256(serializeSignDoc(signDoc)).digest()
  const hexMsg = Buffer.from(msg).toString('hex')
  const note = JSON.stringify(signDoc, null, 2)

  const txInfo = await signer.sign(vault, assetId, delegatorAddress, hexMsg, note)

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
