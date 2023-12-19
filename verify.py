import sys
import logging
import subprocess
import csv
import time
import os
import logging
from logging.handlers import RotatingFileHandler
import socketserver
import threading

WAITING = 0
BANNED = 1
VERIFIED = 2
TRIBOT_MAX_COUNT = 1

class OsVerifyBot(socketserver.BaseRequestHandler):
    def __init__(self, args):
        if len(args) == 1:
            self.srcFilename = "complete.csv"
            self.verifyFilename = "verify.csv"
            self.blockFilename = "block.csv"
        elif len(args) == 4:
            self.srcFilename = args[1]
            self.verifyFilename = args[2]
            self.blockFilename = args[3]
        else:
            print ("Usage : python verify.py [complete.csv verify.csv block.csv]")
            return
        self.logger = logging.getLogger("Verify Log")
        handler = RotatingFileHandler('verify.log')
        handler.setFormatter(logging.Formatter(fmt='%(levelname)s : %(asctime)s : %(message)s'))
        self.logger.addHandler(handler)
        self.logger.setLevel(logging.INFO)
        self.logger.info("start service...")
        print("start service")
        self.verifiedAccounts = dict()
        self.blockedAccounts = dict()
        self.accounts = dict()
        self.processes = dict()
        self.myServer = socketserver.TCPServer(('', 3001), OsVerifyBot)
    
    def processAccount(self, account, password, action):
        self.accounts.pop(account)
        if action == 'ENTER':
            self.verifiedAccounts[account] = password
            with open(self.verifyFilename, 'a+') as f:
                f.write(f"{account}, {password}\n")
        else:
            self.blockedAccounts[account] = password
            with open(self.blockFilename, 'a+') as f:
                f.write(f"{account}, {password}, {action}\n")

    def loadAccounts(self, filename, accounts, drop = False):
        if os.path.exists(filename):
            with open(filename, 'r') as f:
                for row in csv.reader(f):
                    accounts[row[0].strip()] = row[1].strip()
                    if drop:
                        self.accounts.pop(row[0])

    def runProcess(self, account, password):
        params = [
			"java", 
			"-jar", 
			"tribot-splash.jar", 
			"--username", 
			"info@onestopbot.shop", 
			"--password", 
			"Welkom0123456789", 
			"--charusername",
			account,
			"--charpassword",
			password,
			"--charworld",
			"308",
			"--script",
			"VerifyScript",
			"--scriptargs",
			account
		]
        try :
            self.logger.info("running tribot with %s", account)
            p = subprocess.Popen(params)
            print(p.stdout)
            print(p.stderr)
            return p
        except:
            self.logger.info("fail tribot with %s", account)
            return None

    def runVerify(self):
        for account in self.accounts:
            if (len(self.processes.keys()) <= TRIBOT_MAX_COUNT):
                p = self.runProcess(account, self.accounts[account])
                if p != None:
                    self.processes[account] = p
            time.sleep(10)
        while len(self.processes.keys()) > 0:
            time.sleep(3)

    def handle(self):
        while 1:
            dataReceived = self.request.recv(1024)
            if not dataReceived: break
            message = dataReceived.decode("utf-8")
            self.logger.info("receive notify %s", message)
            self.recvProcess(message)

    def recvProcess(self, message):
        [account, action, *args]  = message.split(":")
        if account in self.processes:
            self.logger.info("terminate tribot with %s", account)
            self.processes[account].terminate()
        self.processAccount(account, self.accounts[account], action)

    def start(self):
        self.loadAccounts(self.srcFilename, self.accounts)
        self.loadAccounts(self.verifyFilename, self.verifiedAccounts, drop=True)
        self.loadAccounts(self.blockFilename, self.blockedAccounts, drop=True)
        self.logger.info("load %d source accounts" , len(self.accounts.keys()))
        self.logger.info("load %d verified accounts" , len(self.verifiedAccounts.keys()))
        self.logger.info("load %d blocked accounts" , len(self.blockedAccounts.keys()))
        self.runVerify()

class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    pass

if __name__ == "__main__":
    runner = OsVerifyBot(sys.argv)
    print("server is started....")
    server = ThreadedTCPServer(('localhost', 3001), runner)
    server_thread = threading.Thread(target=server.serve_forever)
    server_thread.daemon = True
    server_thread.start()
    runner.start()
    print("server is closed....")
    server.shutdown()