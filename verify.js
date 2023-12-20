const winston = require("winston");
const csv = require("csvtojson");
const config = require("./config");
const fs = require("fs");
const cp = require("child_process");
const process = require("process");
const net = require("net");
const moment = require("moment");

let logger;
let sourceAccounts = {}; // trained account hash : account => password
let verifiedAccounts = {}; // verified account hash : account => password
let blockedAccounts = {}; // blocked account hash : account => password
let processes = {}; // running process hash : account => starttime

const waitTime = (ms) => {
    return new Promise((resolve) => setTimeout(() => resolve(), ms));
};

// init logger settings
const initLogger = () => {
    logger = winston.createLogger({
        transports: [
            new winston.transports.Console(),
            new winston.transports.File({ filename: "verify.log" }),
        ],
        format: winston.format.combine(
            winston.format.label({ label: "VerifyBOT" }),
            winston.format.timestamp(),
            winston.format.printf(
                ({ level, message, label, timestamp }) =>
                    `${timestamp} [${label}] ${level}: ${message}`
            )
        ),
    });
};

// load accounts from file
const loadAccounts = async (filename, accounts, oldAccounts) => {
    if (!fs.existsSync(filename)) return;
    const rows = await csv({
        noheader: true,
        headers: ["account", "password"],
    }).fromFile(filename);
    rows.forEach(({ account, password, trainedAt }) => {
        if (!oldAccounts && moment(trainedAt, 'YYYY-MM-DD hh:mm').diff(moment(), 'day', true) > 6) {
            accounts[account] = password;
        }
        if (oldAccounts && account in oldAccounts) delete oldAccounts[account];
    });
};

// run tribot verify process
const runTribot = (account, password) => {
    logger.info(`run process ${account}`);
    processes[account] = new Date();
    const ps = cp.spawn("java", [
        "-jar",
        // "c:/Users/Administator/AppData/Roaming/.tribot/install/Splash/tribot-splash.jar",
        "tribot-splash.jar",
        "--username",
        config.TRIBOT_USERNAME,
        "--password",
        config.TRIBOT_PASSWORD,
        "--charusername",
        account,
        "--charpassword",
        password,
        "--charworld",
        config.TRIBOT_WORLD,
        "--script",
        config.VERIFY_SCRIPT,
        "--scriptargs",
        account,
    ]);
};

// select next account from trained accounts
const selectNextAccount = () => {
    for (const account in sourceAccounts) {
        if (account in processes) continue;
        return account;
    }
    return undefined;
};

// start account verify process
const startVerify = async () => {
    while (Object.keys(sourceAccounts).length > 0) {
        logger.info(
            `at the moment ${
                Object.keys(processes).length
            } processes is runinng.`
        );
        if (Object.keys(processes).length < config.VERIFY_MAXCOUNT) {
            const account = selectNextAccount();
            if (account) runTribot(account, sourceAccounts[account]);
        }
        await waitTime(config.VERIFY_INTERVAL * 1000);
    }
    logger.info("verify process is finished.");
};

const findProcess =  (account) => {
    return new Promise((resolve, reject) => {
        cp.exec(`ps -ef | grep ${account}`, (err, stdout) => {
            if (err) {
                reject(err);
            } else {
                if (stdout.indexOf('java') === -1)
                    resolve();
                else
                    resolve(stdout.split(/\s+/)[1]);
            }
        })
    })
};

const closeProcess = async (account) => {
    const pid = await findProcess(account);
    try {
        if (pid)
            process.kill(pid, "SIGKILL");
        delete processes[account];
        return true;
    } catch (e) {
        logger.info(`close process ${account}, ${pid} failed with ${e}`);
        return false;
    }
};

const processAccount = (account, action) => {
    if (action === "ENTER") {
        verifiedAccounts[account] = sourceAccounts[account];
        fs.appendFileSync(
            config.VERIFIED_ACCOUNT,
            `${account}, ${sourceAccounts[account]}\n`,
            { flush: true }
        );
    } else {
        blockedAccounts[account] = sourceAccounts[account];
        fs.appendFileSync(
            config.BLOCKED_ACCOUNT,
            `${account}, ${sourceAccounts[account]}, ${action}\n`,
            { flush: true }
        );
    }
    delete sourceAccounts[account];
};

const processClient = async (account, action) => {
    logger.info(`accept action ${action} from ${account}`);
    processAccount(account, action);
    await closeProcess(account);
};

const startServer = () => {
    const server = net.createServer((socket) => {
        console.log("Client connected");
        socket.on("data", async (data) => {
            const strData = data.toString();
            const [account, action] = strData.split(":");
            await processClient(account, action);
        });
        socket.on("end", () => {
            console.log("Client disconnected");
        });
        socket.on("error", (error) => {
            console.log(`Socket Error: ${error.message}`);
        });
    });

    server.on("error", (error) => {
        console.log(`Server Error: ${error.message}`);
    });

    server.listen(config.VERIFY_PORT, () => {
        console.log(`TCP socket server is running`);
    });
};

const cleanTimer = async () => {
    logger.info("starting cleaning....");
    for (const account in processes) {
        logger.info(
            `check process for ${account}, ${moment().diff(
                moment(processes[account]),
                "minute",
                false
            )}`
        );
        if (moment().diff(moment(processes[account]), "second", false) >= config.VERIFY_TIMEOUT) {
            logger.info(`timeout process from ${account}`);
            processAccount(account, "BLOCK");
            await closeProcess(account);
        }
    }
    logger.info("end cleaning....");
};

const main = async () => {
    initLogger();
    logger.info("starting verify bot....");
    startServer();
    setInterval(cleanTimer, config.CLEAN_INTERVAL * 1000);
    await loadAccounts(config.TRAINED_ACCOUNT, sourceAccounts);
    await loadAccounts(
        config.VERIFIED_ACCOUNT,
        verifiedAccounts,
        sourceAccounts
    );
    await loadAccounts(config.BLOCKED_ACCOUNT, blockedAccounts, sourceAccounts);
    logger.info(`load ${Object.keys(sourceAccounts).length} trained accounts`);
    logger.info(
        `load ${Object.keys(verifiedAccounts).length} verified accounts`
    );
    logger.info(`load ${Object.keys(blockedAccounts).length} blocked accounts`);
    await startVerify();
    process.exit();
};

main();
