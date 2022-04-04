/* simulation script to run on mainnet fork */
// This script unpauses new collateral after they have been deployed
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

  const newLiquidityGaugeInterface = new utils.Interface([
    'function recover_erc20(address token, address addr, uint256 amount) external',
    'function set_staking_token_and_scaling(address token, uint256 _value) external',
  ]);

  const erc20Interface = new utils.Interface(['function balanceOf(address token) external view returns(uint256)']);
  const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const usdcContract = new ethers.Contract(usdc, erc20Interface, governorSigner);
  const gUNIUSDC = '0x2bD9F7974Bc0E4Cb19B8813F8Be6034F3E772add';

  const angle = CONTRACTS_ADDRESSES[ChainId.MAINNET].ANGLE;
  const veAngle = CONTRACTS_ADDRESSES[ChainId.MAINNET].veANGLE;
  const gaugeUSDC = CONTRACTS_ADDRESSES[ChainId.MAINNET].ExternalStakings![0].liquidityGaugeAddress;

  const gaugeETH = CONTRACTS_ADDRESSES[ChainId.MAINNET].ExternalStakings![1].liquidityGaugeAddress;
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
  console.log('Success: storage has not been tampered with');
  console.log('');
  /*
  console.log('Swapping USDC');
  const uniswap = new ethers.Contract(
    // Uniswap Router V2
    '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    [
      'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline)' +
        'external payable returns (uint[] memory amounts)',
    ],
    governorSigner,
  );

  const txSwap = await uniswap.swapExactETHForTokens(
    0,
    ['0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', usdc],
    contractLiquidityGauge.address,
    parseAmount.ether(1),
    {
      value: parseAmount.ether(10),
    },
  );
  await txSwap.wait();
  console.log('Success, swapped USDC');
  console.log('');
  */

  const toAddress = '0xC16B81Af351BA9e64C1a069E3Ab18c244A1E3049';
  const amount = 100;
  console.log('Now checking recoverERC20 with stakingToken');
  await (await contractLiquidityGaugeUpgrade.connect(governorSigner).recover_erc20(gUNIUSDC, toAddress, amount)).wait();
  const guniContract = new ethers.Contract(gUNIUSDC, erc20Interface, governorSigner);
  expect(await guniContract.balanceOf(toAddress)).to.be.equal(amount);
  console.log('Success');
  console.log('');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
