import debugModule from "debug";
const debug = debugModule("test:data:ids");

import { assert } from "chai";

import Ganache from "ganache-cli";

import { prepareContracts } from "../helpers";
import Debugger from "lib/debugger";

import data from "lib/data/selectors";
import trace from "lib/trace/selectors";
import solidity from "lib/solidity/selectors";

const __FACTORIAL = `
pragma solidity ^0.5.0;

contract FactorialTest {

  uint lastResult;

  function factorial(uint n) public returns(uint nbang)
  {
    uint prev;
    uint prevFac;
    nbang = n;
    prev = n - 1; //break here (12)
    if(n>0)
    {
      prevFac = factorial(n - 1);
      nbang = n * prevFac;
    }
    else
    {
      nbang = 1;
    }
    lastResult = nbang; //break here (22)
  }
}
`;

const __ADDRESS = `
pragma solidity ^0.5.0;

contract AddressTest {

  uint8 x;
  uint8 y;
  uint8 result;

  function run() public
  {
    SecretByte test1 = new SecretByte(107);
    SecretByte test2 = new SecretByte(46);
    x = test1.mangle();
    y = test2.mangle();
  }
}

contract SecretByte {

  uint8 private secret;

  constructor(uint8 n) public
  {
    secret = n;
  }

  function mangle() public view returns (uint8)
  {
    uint8 mangled;
    mangled = secret + 1;

    return mangled; //break here (32)

  }
}
`;

const __INTERVENING = `
pragma solidity ^0.5.0;

import "./InterveningLib.sol";

contract Intervening {

  Inner inner;

  constructor(address _inner) public {
    inner = Inner(_inner);
  }

  function run() public {
    uint8 flag;
    flag = 0;
    inner.run();

    flag = 1; //break here (18)

  }

  function runLib() public {
    uint8 flag;
    flag = 0;
    flag = InterveningLib.run();

    flag = 1; //break here (27)

  }
}

contract Inner {

  uint8 flag;

  constructor() public {
    flag = 0;
  }

  function run() public returns (uint8) {
    flag = 1;
    return 2;
  }
}

`;

const __INTERVENINGLIB = `
pragma solidity ^0.5.0;

library InterveningLib {

  function run() pure external returns (uint8) {
    return 2;
  }
}
`;

const __MIGRATION = `
let Intervening = artifacts.require("Intervening");
let Inner = artifacts.require("Inner");
let AddressTest = artifacts.require("AddressTest");
let FactorialTest = artifacts.require("FactorialTest");
let InterveningLib = artifacts.require("InterveningLib");

module.exports = async function(deployer) {
  await deployer.deploy(InterveningLib);
  await deployer.deploy(Inner);
  const inner = await Inner.deployed();
  await deployer.link(InterveningLib, Intervening);
  await deployer.deploy(Intervening, inner.address);
  await deployer.deploy(AddressTest);
  await deployer.deploy(FactorialTest);
};
`;

let sources = {
  "FactorialTest.sol": __FACTORIAL,
  "AddressTest.sol": __ADDRESS,
  "Intervening.sol": __INTERVENING,
  "InterveningLib.sol": __INTERVENINGLIB
};

let migrations = {
  "2_deploy_contracts.js": __MIGRATION
};

describe("Variable IDs", function() {
  var provider;

  var abstractions;
  var artifacts;
  var files;

  before("Create Provider", async function() {
    provider = Ganache.provider({ seed: "debugger", gasLimit: 7000000 });
  });

  before("Prepare contracts and artifacts", async function() {
    this.timeout(30000);

    let prepared = await prepareContracts(provider, sources, migrations);
    abstractions = prepared.abstractions;
    artifacts = prepared.artifacts;
    files = prepared.files;
  });

  it("Distinguishes between stackframes", async function() {
    let instance = await abstractions.FactorialTest.deployed();
    let receipt = await instance.factorial(3);
    let txHash = receipt.tx;

    let bugger = await Debugger.forTx(txHash, {
      provider,
      files,
      contracts: artifacts
    });

    let session = bugger.connect();
    debug("sourceId %d", session.view(solidity.current.source).id);

    let sourceId = session.view(solidity.current.source).id;
    session.addBreakpoint({ sourceId, line: 12 });
    session.addBreakpoint({ sourceId, line: 22 });

    var values = [];

    session.continueUntilBreakpoint();
    while (!session.view(trace.finished)) {
      values.push(session.view(data.current.identifiers.native)["nbang"]);
      session.continueUntilBreakpoint();
    }

    assert.deepEqual(values, [3, 2, 1, 0, 1, 1, 2, 6]);
  });

  it("Learns contract addresses and distinguishes the results", async function() {
    this.timeout(4000);
    let instance = await abstractions.AddressTest.deployed();
    let receipt = await instance.run();
    let txHash = receipt.tx;

    let bugger = await Debugger.forTx(txHash, {
      provider,
      files,
      contracts: artifacts
    });

    let session = bugger.connect();
    debug("sourceId %d", session.view(solidity.current.source).id);

    let sourceId = session.view(solidity.current.source).id;
    session.addBreakpoint({ sourceId, line: 32 });
    session.continueUntilBreakpoint();
    debug("node %o", session.view(solidity.current.node));
    assert.equal(session.view(data.current.identifiers.native)["secret"], 107);
    session.continueUntilBreakpoint();
    debug("node %o", session.view(solidity.current.node));
    assert.equal(session.view(data.current.identifiers.native)["secret"], 46);
  });

  it("Stays at correct stackframe after contract call", async function() {
    let instance = await abstractions.Intervening.deployed();
    let receipt = await instance.run();
    let txHash = receipt.tx;

    let bugger = await Debugger.forTx(txHash, {
      provider,
      files,
      contracts: artifacts
    });

    let session = bugger.connect();
    debug("sourceId %d", session.view(solidity.current.source).id);

    let sourceId = session.view(solidity.current.source).id;
    session.addBreakpoint({ sourceId, line: 18 });
    session.continueUntilBreakpoint();
    assert.property(session.view(data.current.identifiers.native), "flag");
  });

  it("Stays at correct stackframe after library call", async function() {
    let instance = await abstractions.Intervening.deployed();
    let receipt = await instance.runLib();
    let txHash = receipt.tx;

    let bugger = await Debugger.forTx(txHash, {
      provider,
      files,
      contracts: artifacts
    });

    let session = bugger.connect();
    debug("sourceId %d", session.view(solidity.current.source).id);

    let sourceId = session.view(solidity.current.source).id;
    session.addBreakpoint({ sourceId, line: 27 });
    session.continueUntilBreakpoint();
    assert.property(session.view(data.current.identifiers.native), "flag");
  });
});
