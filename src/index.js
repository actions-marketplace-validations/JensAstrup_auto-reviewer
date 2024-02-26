import {Octokit} from '@octokit/rest'
import OpenAI from 'openai'
import {execSync} from 'child_process'


const client = new OpenAI({apiKey: process.env.OPENAI_API_KEY})
const githubToken = process.env.GITHUB_TOKEN
const octokit = new Octokit({auth: githubToken})


class PullRequestReviewer {
  constructor(diffText) {
    this.diffText = diffText
  }

  async createThread() {
    const messages = [{
      role: 'user',
      content: this.diffText
    }]
    return client.beta.threads.create({
        messages: messages
      }
    )
  }

  async runThread() {
    const thread = await this.createThread()
    const run = await client.beta.threads.runs.create(
      thread.id,
      {assistant_id: 'asst_rT9Jf2KyaPezH88ELvs8SfZ9'}
    )
    return {run: run, threadId: thread.id}
  }

  async retrieveThread(runId, threadId) {
    return client.beta.threads.runs.retrieve(threadId, runId)
  }

  async review() {
    let {run, threadId} = await this.runThread()
    while (!['cancelled', 'failed', 'completed', 'expired'].includes(run.status)) {
      run = await this.retrieveThread(run.id, threadId)
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
    const messages = await client.beta.threads.messages.list(
      threadId
    )
    return messages.data[0].content[0].text.value
  }

}


async function run() {
  try {
    // Fetch the base branch
    execSync('git fetch origin ${GITHUB_BASE_REF}', {stdio: 'inherit'})

    // Generate git diff and filter out specific files
    const command = 'git diff --name-only FETCH_HEAD..HEAD | grep -vE "package-lock.json$"'
    const diffFiles = execSync(command).toString().trim().split('\n')
    let diffText = ''

    for (const file of diffFiles) {
      if (file) {
        const diff = execSync(`git diff FETCH_HEAD..HEAD -- "${file}"`).toString()
        diffText += diff + '\n'
      }
    }

    console.log('Running review script...')

    const reviewer = new PullRequestReviewer(diffText)
    const output = await reviewer.review()

    const prNumber = process.env.PR_NUMBER
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')

    // Post comment to PR
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: output
    })

    console.log('Review comment posted successfully.')

  } catch (error) {
    console.error('Failed to run review:', error)
    process.exit(1)
  }
}

await run()
