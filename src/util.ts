import * as readline from 'readline'
import chalk from 'chalk'
import { promises as fsPromises } from 'fs'
import { type Journal, type JournalEntry, type Config } from './types'

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

      await writeJournal({
        type,
        timestamp: Math.floor(Date.now() / 1000),
        data: JSON.stringify(data, null, 2)
      }, this.withJournal)

      return result
    }
  }
}

async function writeJournal (entry: JournalEntry, enabled: boolean): Promise<void> {
  if (!enabled) {
    return
  }

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
