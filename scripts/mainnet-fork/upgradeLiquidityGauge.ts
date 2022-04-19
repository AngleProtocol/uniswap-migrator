import { network, ethers } from 'hardhat';
import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { expect } from './chai-setup';
import { parseAmount, formatAmount } from '../../utils/bignumber';
import {
  // eslint-disable-next-line camelcase
  LiquidityGaugeV4_Interface,
} from '@angleprotocol/sdk/dist/constants/interfaces';
import { utils } from 'ethers';

async function main() {
  // =============== Simulation parameters ====================

  // const params = CONSTANTS(1);

  const governor = '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8';
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [governor],
  });

  await network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
  const governorSigner = await ethers.provider.getSigner(governor);

  const depositor = '0x4F4715CA99C973A55303bc4a5f3e3acBb9fF75DB';
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [depositor],
  });
  await network.provider.send('hardhat_setBalance', [depositor, '0x10000000000000000000000000000']);
  const depositorSigner = await ethers.provider.getSigner(depositor);

  const newLiquidityGaugeInterface = new utils.Interface([
    'function recover_erc20(address token, address addr, uint256 amount) external',
    'function set_staking_token_and_scaling_factor(address token, uint256 _value) external',
    'function initialized() external view returns(bool)',
    'function staking_token() external view returns(address)',
    'function decimal_staking_token() external view returns(uint256)',
    'function scaling_factor() external view returns(uint256)',
  ]);

  const erc20Interface = new utils.Interface(['function balanceOf(address token) external view returns(uint256)']);
  const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const usdcContract = new ethers.Contract(usdc, erc20Interface, governorSigner);
  const gUNIUSDC = '0x2bD9F7974Bc0E4Cb19B8813F8Be6034F3E772add';

  const angle = CONTRACTS_ADDRESSES[ChainId.MAINNET].ANGLE;
  const veAngle = CONTRACTS_ADDRESSES[ChainId.MAINNET].veANGLE;
  const gaugeUSDC = CONTRACTS_ADDRESSES[ChainId.MAINNET].ExternalStakings![0].liquidityGaugeAddress;
  const liquidityGaugeAddress: string = gaugeUSDC !== undefined ? gaugeUSDC : '0x';
  const contractLiquidityGauge = new ethers.Contract(liquidityGaugeAddress, LiquidityGaugeV4_Interface, governorSigner);
  const contractLiquidityGaugeUpgrade = new ethers.Contract(
    liquidityGaugeAddress,
    newLiquidityGaugeInterface,
    governorSigner,
  );

  console.log('Checking if storage has not been tampered with during the upgrade');
  expect(await contractLiquidityGauge.ANGLE()).to.be.equal(angle);
  expect(await contractLiquidityGauge.voting_escrow()).to.be.equal(veAngle);
  expect(await contractLiquidityGauge.admin()).to.be.equal(governor);
  expect(await contractLiquidityGauge.staking_token()).to.be.equal(gUNIUSDC);
  expect(await contractLiquidityGauge.decimal_staking_token()).to.be.equal(18);
  expect(await contractLiquidityGauge.reward_count()).to.be.equal(1);
  expect(await contractLiquidityGauge.reward_tokens(0)).to.be.equal(angle);
  expect(await contractLiquidityGauge.admin()).to.be.equal(governor);
  expect(await contractLiquidityGaugeUpgrade.initialized()).to.be.equal(true);

  const userAddress = '0x4F4715CA99C973A55303bc4a5f3e3acBb9fF75DB';
  // The following values should be non null
  console.log('Displaying working balance and reward integral');
  console.log((await contractLiquidityGauge.working_balances(userAddress)).toString());
  const value = (
    await contractLiquidityGauge.reward_integral_for('0x31429d1856aD1377A8A0079410B297e1a9e214c2', userAddress)
  ).toString();
  console.log(value);

  const rewardData = await contractLiquidityGauge.reward_data(angle);
  console.log(rewardData);
  console.log('');
  console.log('Success: storage has not been tampered with');
  console.log('');
  const toAddress = '0xC16B81Af351BA9e64C1a069E3Ab18c244A1E3049';
  const amount = 100;
  console.log('Now checking recoverERC20 with stakingToken');
  const guniContract = new ethers.Contract(gUNIUSDC, erc20Interface, governorSigner);
  await (await contractLiquidityGaugeUpgrade.connect(governorSigner).recover_erc20(gUNIUSDC, toAddress, amount)).wait();

  expect(await guniContract.balanceOf(toAddress)).to.be.equal(amount);
  console.log('Success');
  console.log('');

  console.log('New admin functions revert if not admin');
  await expect(contractLiquidityGaugeUpgrade.connect(depositorSigner).recover_erc20(gUNIUSDC, toAddress, amount)).to.be
    .reverted;
  await expect(
    contractLiquidityGaugeUpgrade.connect(depositorSigner).set_staking_token_and_scaling_factor(gUNIUSDC, amount),
  ).to.be.reverted;
  console.log('Success on the admin functions');
  console.log('');
  console.log('Set staking token success if admin');
  await (
    await contractLiquidityGaugeUpgrade
      .connect(governorSigner)
      .set_staking_token_and_scaling_factor(usdcContract.address, 300)
  ).wait();

  expect(await contractLiquidityGaugeUpgrade.staking_token()).to.be.equal(usdcContract.address);
  expect(await contractLiquidityGaugeUpgrade.decimal_staking_token()).to.be.equal(6);
  expect(await contractLiquidityGaugeUpgrade.scaling_factor()).to.be.equal(300);
  console.log('Success');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
