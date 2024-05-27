import * as readline from 'readline'
import * as process from 'process'
import chalk from 'chalk'
import { promises as fsPromises } from 'fs'
import { type Journal, type JournalEntry, type Config } from './types'
import { NetworkType } from './enums'

async function fileExists (path: string): Promise<boolean> {
  return await fsPromises
    .access(path, fsPromises.constants.F_OK)
    .then(() => true)
    .catch(() => false)
}

type Fn = (s1: any) => any

// write a decorator function called journal that logs the result of a method
export function journal (type: string, dataFn?: Fn) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ): void {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const result = await originalMethod.apply(this, args)

      let data = result
      if (dataFn !== undefined) {
        data = dataFn(data)
      }

      if (this.withJournal === true) {
        await writeJournal({
          type,
          timestamp: Math.floor(Date.now() / 1000),
          data: JSON.stringify(data, null, 2)
        })
      }

      return result
    }
  }
}

async function writeJournal (entry: JournalEntry): Promise<void> {
  let journal: Journal = { entries: [] }
  if (await fileExists('./journal.log')) {
    const journalFile = await fsPromises.readFile('./journal.log', 'utf-8')
    journal = JSON.parse(journalFile)
  }

  journal.entries.push(entry)

  await fsPromises.writeFile(
    './journal.log',
    JSON.stringify(journal, null, 2),
    { flag: 'w' }
  )
}

export async function readConfig (path: string): Promise<Config> {
  const configFile = await fsPromises.readFile(path, 'utf-8')
  const cfg: Config = JSON.parse(configFile)

  return cfg
}

export function getNetworkConfig<T> (cfg: Config): T {
  if (cfg.networkType === undefined) {
    throw new Error('networkType is missing in configuration')
  }

  switch (cfg.networkType) {
    case NetworkType.NEAR:
      if (cfg.near === undefined) {
        throw new Error('near configuration is missing')
      }
      return cfg.near as T
    case NetworkType.COSMOS:
      if (cfg.cosmos === undefined) {
        throw new Error('cosmos configuration is missing')
      }
      return cfg.cosmos as T
    case NetworkType.SUBSTRATE:
      if (cfg.substrate === undefined) {
        throw new Error('substrate configuration is missing')
      }
      return cfg.substrate as T
  }
}

export async function prompt (ask: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  try {
    while (true) {
      const userInput = await new Promise<string>((resolve) => {
        rl.question(ask + ' [y/n]: ', resolve)
      })

      const lowerCaseInput = userInput.toLowerCase()

      if (lowerCaseInput === 'y' || lowerCaseInput === 'yes') {
        return await Promise.resolve(true)
      } else if (lowerCaseInput === 'n' || lowerCaseInput === 'no') {
        return await Promise.resolve(false)
      } else {
        console.log('Invalid input. Please enter either "y" or "n".')
      }
    }
  } finally {
    rl.close()
  }
}

export function print (step: number, total: number, msg: string): void {
  console.log(chalk.green(`# [${step}/${total}] ${msg}`))
}

export function checkNodeVersion (versionPrefix: string, err?: string): void {
  const version = process.version
  if (version.startsWith(versionPrefix)) {
    if (err !== undefined) {
      console.error(err)
    } else {
      console.error(`Error: Node.js version ${version} is not supported.`)
    }
    process.exit(1)
  }
}
