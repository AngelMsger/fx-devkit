#!groovy
// Internal package delivery. Untrusted branches run checks without release credentials.
pipeline {
    agent {
        docker {
            label 'default'
            image 'node:24.14.0-bookworm'
            args '--init -e HOME=/tmp'
        }
    }
    options {
        disableConcurrentBuilds()
        timeout(time: 45, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10', artifactNumToKeepStr: '3'))
    }
    parameters {
        booleanParam(name: 'PUBLISH_PACKAGE', defaultValue: false,
            description: 'Publish the current main version to the private Registry after all checks pass.')
    }
    environment {
        FX_DISTRIBUTION = 'internal'
    }
    stages {
        stage('Install') {
            steps {
                sh 'node scripts/select-distribution.mjs internal'
                sh 'node --version && npm --version'
                sh 'npm ci'
                sh 'npm --prefix docs/website ci'
                sh 'npm install --prefix /tmp/fx-ci bun@1.3.5'
                sh '/tmp/fx-ci/node_modules/.bin/bun --version'
            }
        }
        stage('Quality') {
            steps {
                sh 'npm run lint'
                sh 'npm run typecheck'
                sh 'npm run docs:check'
            }
        }
        stage('Test') {
            parallel {
                stage('Node') { steps { sh 'npm test' } }
                stage('Bun') { steps { sh 'PATH="/tmp/fx-ci/node_modules/.bin:$PATH" npm run test:bun' } }
            }
        }
        stage('Acceptance') {
            steps {
                sh 'npm run test:e2e'
                sh 'node scripts/check-package.mjs'
                sh 'SITE_BASE_PATH=/fx-devkit/ SITE_ORIGIN=https://docs.example.com npm run site:build'
                sh 'npm run site:check'
                sh 'SITE_BASE_PATH=/ SITE_ORIGIN= npm run site:build'
                sh 'npm run site:check'
                archiveArtifacts artifacts: 'docs/website/dist/**', fingerprint: true
            }
        }
        stage('Publish') {
            when {
                allOf {
                    not { changeRequest() }
                    anyOf {
                        tag pattern: 'v*', comparator: 'GLOB'
                        allOf {
                            branch 'main'
                            expression { params.PUBLISH_PACKAGE }
                        }
                    }
                }
            }
            steps {
                sh 'node scripts/check-release.mjs'
                configFileProvider([configFile(fileId: 'npm-ci-config', variable: 'NPM_CONFIG_USERCONFIG')]) {
                    withCredentials([string(credentialsId: 'npm-token', variable: 'NPM_TOKEN')]) {
                        sh 'node scripts/publish-ci.mjs'
                    }
                }
            }
        }
    }
}
