/* eslint-env mocha */
/* global assert contract artifacts */
const Parameterizer = artifacts.require('./Parameterizer.sol');
const Registry = artifacts.require('Registry.sol');

const fs = require('fs');
const BN = require('bignumber.js');

const config = JSON.parse(fs.readFileSync('./conf/config.json'));
const paramConfig = config.paramDefaults;

const utils = require('../utils.js');

contract('Registry', (accounts) => {
  describe('Function: apply', () => {
    const [applicant, proposer] = accounts;

    it('should allow a new listing to apply', async () => {
      const registry = await Registry.deployed();
      const listing = utils.getListingHash('nochallenge.net');

      await utils.as(applicant, registry.apply, listing, paramConfig.minDeposit, '');

      // get the struct in the mapping
      const result = await registry.listings.call(listing);
      // check that Application is initialized correctly
      assert.strictEqual(result[0].gt(0), true, 'challenge time < now');
      assert.strictEqual(result[1], false, 'whitelisted != false');
      assert.strictEqual(result[2], applicant, 'owner of application != address that applied');
      assert.strictEqual(
        result[3].toString(10),
        paramConfig.minDeposit.toString(10),
        'incorrect unstakedDeposit',
      );
    });

    it('should not allow a listing to apply which has a pending application', async () => {
      const registry = await Registry.deployed();
      const listing = utils.getListingHash('nochallenge.net');

      // Verify that the application exists.
      const result = await registry.listings.call(listing);
      assert.strictEqual(result[2], applicant, 'owner of application != address that applied');

      try {
        await utils.as(applicant, registry.apply, listing, paramConfig.minDeposit, '');
      } catch (err) {
        assert(utils.isEVMException(err), err.toString());
        return;
      }
      assert(false, 'application was made for listing with an already pending application');
    });

    it(
      'should add a listing to the whitelist which went unchallenged in its application period',
      async () => {
        const registry = await Registry.deployed();
        const listing = utils.getListingHash('nochallenge.net');
        await utils.increaseTime(paramConfig.applyStageLength + 1);
        await registry.updateStatus(listing);
        const result = await registry.isWhitelisted.call(listing);
        assert.strictEqual(result, true, "listing didn't get whitelisted");
      },
    );

    it('should not allow a listing to apply which is already listed', async () => {
      const registry = await Registry.deployed();
      const listing = utils.getListingHash('nochallenge.net');

      // Verify that the listing is whitelisted.
      const result = await registry.isWhitelisted.call(listing);
      assert.strictEqual(result, true, 'listing was not already whitelisted.');

      try {
        await utils.as(applicant, registry.apply, listing, paramConfig.minDeposit, '');
      } catch (err) {
        // TODO: Check if EVM error
        const errMsg = err.toString();
        assert(utils.isEVMException(err), errMsg);
        return;
      }
      assert(false, 'application was made for an already-listed entry');
    });

    it('should revert if the listing\'s applicationExpiry would overflow', async () => {
      const parameterizer = await Parameterizer.deployed();
      const registry = await Registry.deployed();

      // calculate an applyStageLen which when added to the current block time will be greater
      // than 2^256 - 1
      const blockTimestamp = await utils.getBlockTimestamp();
      const maxEVMuint = new BN('2').pow('256').minus('1');
      const applyStageLen = maxEVMuint.minus(blockTimestamp).plus('1');

      const receipt = await utils.as(proposer, parameterizer.proposeReparameterization, 'applyStageLen', applyStageLen.toString(10));
      const { propID } = receipt.logs[0].args;

      // wait until the apply stage has elapsed and process the proposal
      await utils.increaseTime(paramConfig.pApplyStageLength + 1);
      await parameterizer.processProposal(propID);

      // make sure that the reparameterization proposal was processed as expected
      const actualApplyStageLen = await parameterizer.get.call('applyStageLen');
      assert.strictEqual(actualApplyStageLen.toString(), applyStageLen.toString(), 'the applyStageLen should have been the proposed value');

      const listing = utils.getListingHash('overflow.net');

      try {
        await utils.as(applicant, registry.apply, listing, paramConfig.minDeposit, '');
      } catch (err) {
        assert(err.toString().includes('invalid opcode'), err.toString());
        return;
      }
      assert(false, 'app expiry was allowed to overflow!');
    });

    it('should revert if the deposit amount is less than the minDeposit', async () => {
      const parameterizer = await Parameterizer.deployed();
      const registry = await Registry.deployed();
      const listing = utils.getListingHash('smallDeposit.net');

      const minDeposit = await parameterizer.get.call('minDeposit');
      const deposit = minDeposit.sub(10);

      try {
        await utils.as(applicant, registry.apply, listing, deposit.toString(), '');
      } catch (err) {
        assert(utils.isEVMException(err), err.toString());
        return;
      }
      assert(false, 'allowed an application with deposit less than minDeposit');
    });
  });
});

