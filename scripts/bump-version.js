#!/usr/bin/env node
/**
 * Bump version script
 * Usage: node scripts/bump-version.js [major|minor|patch]
 * Default: patch
 */

const fs = require('fs')
const path = require('path')

const packagePath = path.join(__dirname, '../package.json')
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'))

const type = process.argv[2] || 'patch'
const [major, minor, patch] = pkg.version.split('.').map(Number)

let newVersion
switch (type) {
  case 'major':
    newVersion = `${major + 1}.0.0`
    break
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`
    break
  case 'patch':
  default:
    newVersion = `${major}.${minor}.${patch + 1}`
}

pkg.version = newVersion
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n')

console.log(`Version bumped: ${major}.${minor}.${patch} → ${newVersion}`)
