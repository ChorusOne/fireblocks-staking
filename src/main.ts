import { Command } from '@commander-js/extra-typings'
import { makeCosmosCommand } from './cosmos/cmd'
import { makeNearCommand } from './near/cmd'

const program = new Command()

program
  .name('fireblocks-staking')
  .description('CLI to manage funds for fireblocks accounts')
  .option('-c, --config <path>', 'path to configuration file', 'config.json')
  .option(
    '-s, --signer <type>',
    'choose signer with which you want to sign TX. Options: local or fireblocks',
    'fireblocks'
  )
  .version('1.0.0')

program.addCommand(makeCosmosCommand())
program.addCommand(makeNearCommand());

(async () => {
  await program.parseAsync()
})().catch(e => {
  console.error(e)
})
