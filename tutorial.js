const winston = require("winston");
const csv = require("csvtojson");
const config = require("./config");
const fs = require("fs");
const cp = require("child_process");
const process = require("process");
const net = require("net");
const moment = require("moment");

let logger;
let rawAccounts = {}; // trained account hash : account => password
let trainedAccounts = {}; // verified account hash : account => password
let wrongAccounts = {}; // verified account hash : account => password
let processes = {}; // running process hash : account => starttime
let proxies = [];   // proxy hash : proxy str => using

const waitTime = (ms) => {
    return new Promise((resolve) => setTimeout(() => resolve(), ms));
};

// init logger settings
const initLogger = () => {
    logger = winston.createLogger({
        transports: [
            new winston.transports.Console(),
            new winston.transports.File({ filename: "tutorial.log" }),
        ],
        format: winston.format.combine(
            winston.format.label({ label: "TutorBOT" }),
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
    logger.info(`load accounts from ${filename}.`);
    rows.forEach(({ account, password }) => {
        accounts[account.trim()] = password.trim();
        logger.info(`read account ${account}.`);
        if (oldAccounts && account.trim() in oldAccounts) {
            logger.info(`${account} is already trained.`)
            delete oldAccounts[account.trim()];
        }
    });
};

// load accounts from file
const loadProxies = async () => {
    if (!fs.existsSync(config.PROXY_ACCOUNT)) return;
    const rows = await csv({
        noheader: true,
        headers: ["username", "password", "address", "port"],
    }).fromFile(config.PROXY_ACCOUNT);
    rows.forEach(({ username, password, address, port }) => {
        console.log(username, password, address, port);
        proxies.push({username, password, address, port});
    });
};

// run tribot verify process
const runTribot = (account, proxy) => {
    logger.info(`run process ${account} with ${JSON.stringify(proxy)}, ${proxy.address}`);
    processes[account] = { starttime: new Date(), proxy: proxy};
    cp.spawn("java", 
    [
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
        rawAccounts[account],
        "--charworld",
        config.TRIBOT_WORLD,
        "--script",
        config.TUTORIAL_SCRIPT,
        "--scriptargs",
        account
    ]);
};

// select next account from trained accounts
const selectNextAccount = () => {
    for (const account in rawAccounts) {
        if (account in processes) continue;
        return account;
    }
    return undefined;
};


// start account verify process
const startTutorial = async () => {
    while (Object.keys(rawAccounts).length > 0) {
        logger.info(`stats : ${
                Object.keys(processes).length
            } processes, ${proxies.length} proxies, ${Object.keys(rawAccounts).length} accounts.`
        );
        if (Object.keys(processes).length < config.TUTORIAL_MAXCOUNT) {
            const account = selectNextAccount();
            const proxy = proxies.shift();
            logger.info(`select ${account} and ${proxy}.`);
            if (account && proxy) runTribot(account, proxy);
        }
        await waitTime(config.TUTORIAL_INTERVAL * 1000);
    }
    logger.info("tutorial bot is finished.");
};

const findProcess = async (account) => {
    const pslist = require("process-list");
    const tasks = await pslist.snapshot("pid", "name", "starttime");
    let ptask;
    let diffSecs = 6000;
    console.log(JSON.stringify(processes[account]));
    const tasktime = processes[account].starttime;
    tasks
        .filter((task) => task.name.indexOf("java") !== -1)
        .forEach((task) => {
            if (moment(task.starttime).isAfter(moment(tasktime))) {
                if (
                    diffSecs >
                    moment(task.starttime).diff(
                        moment(tasktime),
                        "second",
                        false
                    )
                ) {
                    ptask = task;
                    diffSecs = moment(task.starttime).diff(
                        moment(tasktime),
                        "second",
                        false
                    );
                }
            }
        });
    return ptask ? ptask.pid : -1;
};

const closeProcess = async (account) => {
    const pid = await findProcess(account);
    try {
        process.kill(pid, "SIGKILL");
        proxies.push(processes[account].proxy);
        delete processes[account];
        return true;
    } catch (e) {
        logger.info(`close process ${account}, ${pid} failed with ${e}`);
        return false;
    }
};

const processAccount = (account) => {
        trainedAccounts[account] = rawAccounts[account];
        fs.appendFileSync(
            config.TRAINED_ACCOUNT,
            `${account}, ${rawAccounts[account]}, ${moment().format('YYYY-MM-DD hh:mm')}\n`,
            { flush: true }
        );
        delete rawAccounts[account];
};

const wrongAccount = (account) => {
    fs.appendFileSync(
        config.WRONG_ACCOUNT,
        `${account}, ${rawAccounts[account]}, ${moment().format('YYYY-MM-DD hh:mm')}\n`,
        { flush: true }
    );
    delete rawAccounts[account];
};

const processClient = async (account, action) => {
    logger.info(`accept action ${action} from ${account}`);
    if (action === 'SUCCESS')
        processAccount(account, action);
    await closeProcess(account);
};

const startServer = () => {
    const server = net.createServer((socket) => {
        socket.on("data", async (data) => {
            const strData = data.toString();
            const [account, action] = strData.split(":");
            await processClient(account, action);
        });
    });
   server.listen(config.TUTORIAL_PORT, () => {
        logger.info(`tutorial listening server is started.`);
    });
};

const cleanTimer = async () => {
    logger.info("starting cleaning....");
    for (const account in processes) {
        logger.info(
            `check process for ${account}, ${moment().diff(
                moment(processes[account].starttime),
                "minute",
                false
            )}`
        );
        if (moment().diff(moment(processes[account].starttime), "second", false) >= config.TUTORIAL_TIMEOUT) {
            logger.info(`timeout process from ${account}`);
            wrongAccount(account);
            await closeProcess(account);
        }
    }
    logger.info("end cleaning....");
};

const main = async () => {
    initLogger();
    logger.info("starting tutorial bot....");
    startServer();
    setInterval(cleanTimer, config.CLEAN_INTERVAL * 1000);
    await loadAccounts(config.RAW_ACCOUNT, rawAccounts);
    logger.info(`load ${Object.keys(rawAccounts).length} raw accounts`);
    await loadAccounts(
        config.TRAINED_ACCOUNT,
        trainedAccounts,
        rawAccounts
    );
    await loadAccounts(
        config.WRONG_ACCOUNT,
        wrongAccounts,
        rawAccounts
    );
    await loadProxies();
    logger.info(`load ${Object.keys(rawAccounts).length} raw accounts`);
    logger.info(
        `load ${Object.keys(trainedAccounts).length} trained accounts`
    );
    logger.info(
        `load ${Object.keys(wrongAccounts).length} wrong accounts`
    );
    logger.info(`load ${proxies.length} proxies`);
    await startTutorial();
    process.exit();
};

main();
