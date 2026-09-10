#!groovy
// Lint, test on both runtimes, run the end-to-end suite, and publish on a
// version tag. Bun is installed per build because the default agent does not
// carry it; a tag build that fails any stage does not publish.
pipeline {
    agent {
        node { label 'default' }
    }

    options {
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '5'))
    }

    environment {
        NPM_TOKEN = credentials('npm-token')
        BUN_INSTALL = "${WORKSPACE}/.bun"
        PATH = "${WORKSPACE}/.bun/bin:${PATH}"
    }

    stages {
        stage('Install') {
            steps {
                sh 'npm ci'
                sh 'command -v bun || curl -fsSL https://bun.sh/install | bash'
            }
        }
        stage('Lint') {
            steps {
                sh 'npm run lint'
                sh 'npm run typecheck'
                sh 'npm run build'
                sh 'npm run docs:check'
            }
        }
        stage('Test') {
            parallel {
                stage('node') {
                    steps { sh 'npm test' }
                }
                stage('bun') {
                    steps { sh 'npm run test:bun' }
                }
            }
        }
        stage('E2E') {
            steps {
                sh 'npm run test:e2e'
            }
        }
        stage('Publish') {
            when { tag 'v*' }
            steps {
                sh 'node scripts/publish.mjs'
            }
        }
    }
}
