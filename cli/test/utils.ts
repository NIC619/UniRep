import * as shell from 'shelljs'

const exec = (command: string) => {
    return shell.exec(command, { silent: false })
}

export { exec }