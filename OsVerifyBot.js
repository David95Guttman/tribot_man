const winston = require('winston');
const csv = require('csvtojson');
const config = require('./config');
const fs = require('fs');
const cp = require('child_process');
const { resolve } = require('path');
const { rejects } = require('assert');

let logger;
let sourceAccounts = {};
let verifiedAccounts = {}
let blockedAccounts = {}
let processes = {};

const initLogger = () => {
    logger = winston.createLogger({
        transports: [
            new winston.transports.Console(),
            new winston.transports.File({ filename: "OsBot.log" }),
        ],
        format: winston.format.combine(
            winston.format.label({ label: 'OSBOT' }),
            winston.format.timestamp(),
            winston.format.printf(({ level, message, label, timestamp }) => `${timestamp} [${label}] ${level}: ${message}`)
          )
    });
}

const loadAccounts = async (filename, accounts, oldAccounts) => {
    if (!fs.existsSync(filename))
        return; 
    const rows = await csv({
        noheader: true,
        headers: ["account", "password"]
    }).fromFile(filename);
    rows.forEach(({account, password}) => {
        accounts[account] = password;
        if (oldAccounts && account in oldAccounts)
            delete oldAccounts[account]
    });
};

const runTribot = (account, password) => {
    logger.info(`run process ${account}`)
    // const ps = cp.exec(`java -jar tribot-splash.jar --username ${config.TRIBOT_USERNAME} --password ${config.TRIBOT_PASSWORD} --charusername ${account} --charpassword ${password} --charworld ${config.TRIBOT_WORLD}  --script ${config.TRIBOT_SCRIPT} --scriptargs ${account}`);
    const ps = cp.exec(`java -jar tribot-splash.jar`, (err, stdout, stderr) => {
       if (err) {
            logger.info(`process ${account} is closed with error`);
            delete processes[account];    
       }
    });
    processes[account] = ps;
}

const waitTime = (ms) => {
    return new Promise((resolve) => setTimeout(() => resolve(), ms))
}

const startVerify = async () => {
    for (const account in sourceAccounts) {
        if (Object.keys(processes).length <= config.TRIBOT_MAXCOUNT) 
            runTribot(account, sourceAccounts[account]);
        await waitTime(60000);
    }
}

const main = async () => {
    initLogger();
    logger.info("starting bot....");
    await loadAccounts(config.SOURCE_ACCOUNT, sourceAccounts);
    await loadAccounts(config.VERIFIED_ACCOUNT, verifiedAccounts, sourceAccounts);
    await loadAccounts(config.BLOCKED_ACCOUNT, blockedAccounts, sourceAccounts);
    logger.info(`load ${Object.keys(sourceAccounts).length} source accounts`);
    logger.info(`load ${Object.keys(verifiedAccounts).length} verified accounts`)
    logger.info(`load ${Object.keys(blockedAccounts).length} source accounts`)
    await startVerify();
    for (const account in processes) {
        logger.info(`close process ${account}`);
        processes[account].kill('SIGINT');
        delete processes[account];
    }
    logger.info(`finish bot`);
};

main();
