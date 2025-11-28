#!/usr/bin/env node
/**
 * Changelog Generator
 * Generates CHANGELOG.md from git commits
 * 
 * Usage: node scripts/generate-changelog.js
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const CHANGELOG_PATH = path.join(__dirname, '../CHANGELOG.md')

// Commit type categories
const CATEGORIES = {
  feat: { title: '✨ Features', commits: [] },
  fix: { title: '🐛 Bug Fixes', commits: [] },
  perf: { title: '⚡ Performance', commits: [] },
  refactor: { title: '♻️ Refactoring', commits: [] },
  style: { title: '💄 Styling', commits: [] },
  docs: { title: '📚 Documentation', commits: [] },
  test: { title: '✅ Tests', commits: [] },
  build: { title: '📦 Build', commits: [] },
  ci: { title: '🔧 CI/CD', commits: [] },
  chore: { title: '🔨 Chores', commits: [] },
  other: { title: '📝 Other Changes', commits: [] }
}

function getGitTags() {
  try {
    const tags = execSync('git tag --sort=-version:refname', { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(t => t.startsWith('v'))
    return tags
  } catch {
    return []
  }
}

function getCommitsBetween(from, to) {
  try {
    const range = from ? `${from}..${to || 'HEAD'}` : to || 'HEAD'
    const log = execSync(
      `git log ${range} --pretty=format:"%H|%s|%an|%ad" --date=short`,
      { encoding: 'utf-8' }
    )
    
    if (!log.trim()) return []
    
    return log.trim().split('\n').map(line => {
      const [hash, subject, author, date] = line.split('|')
      return { hash: hash.substring(0, 7), subject, author, date }
    })
  } catch {
    return []
  }
}

function categorizeCommit(subject) {
  const match = subject.match(/^(\w+)(?:\(.+\))?:\s*(.+)/)
  if (match) {
    const [, type, message] = match
    const category = CATEGORIES[type] ? type : 'other'
    return { category, message: message.trim() }
  }
  return { category: 'other', message: subject }
}

function generateVersionSection(version, date, commits) {
  // Reset categories
  Object.values(CATEGORIES).forEach(cat => cat.commits = [])
  
  // Categorize commits
  commits.forEach(commit => {
    const { category, message } = categorizeCommit(commit.subject)
    CATEGORIES[category].commits.push({
      message,
      hash: commit.hash,
      author: commit.author
    })
  })
  
  let section = `## [${version}] - ${date}\n\n`
  
  // Generate sections for each category with commits
  Object.values(CATEGORIES).forEach(({ title, commits }) => {
    if (commits.length > 0) {
      section += `### ${title}\n\n`
      commits.forEach(({ message, hash }) => {
        section += `- ${message} (\`${hash}\`)\n`
      })
      section += '\n'
    }
  })
  
  return section
}

function generateChangelog() {
  const tags = getGitTags()
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'))
  
  let changelog = `# Changelog

All notable changes to WhisperDesk will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`

  if (tags.length === 0) {
    // No tags yet, get all commits
    const commits = getCommitsBetween(null, 'HEAD')
    if (commits.length > 0) {
      const today = new Date().toISOString().split('T')[0]
      changelog += generateVersionSection(pkg.version, today, commits)
    }
  } else {
    // Generate section for unreleased changes (if any)
    const unreleasedCommits = getCommitsBetween(tags[0], 'HEAD')
    if (unreleasedCommits.length > 0) {
      const today = new Date().toISOString().split('T')[0]
      changelog += `## [Unreleased]\n\n`
      const { category, message } = categorizeCommit(unreleasedCommits[0].subject)
      // Just list them without categorization for unreleased
      unreleasedCommits.forEach(commit => {
        changelog += `- ${commit.subject} (\`${commit.hash}\`)\n`
      })
      changelog += '\n'
    }
    
    // Generate sections for each tag
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i]
      const prevTag = tags[i + 1] || null
      
      // Get tag date
      let tagDate
      try {
        tagDate = execSync(`git log -1 --format=%ad --date=short ${tag}`, { encoding: 'utf-8' }).trim()
      } catch {
        tagDate = 'Unknown'
      }
      
      const commits = getCommitsBetween(prevTag, tag)
      if (commits.length > 0) {
        changelog += generateVersionSection(tag.replace('v', ''), tagDate, commits)
      }
    }
  }
  
  fs.writeFileSync(CHANGELOG_PATH, changelog)
  console.log(`✅ Changelog generated: ${CHANGELOG_PATH}`)
}

generateChangelog()
