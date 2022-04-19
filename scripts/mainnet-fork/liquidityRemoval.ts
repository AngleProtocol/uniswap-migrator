import { network, ethers, deployments, contract } from 'hardhat';
import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { expect } from './chai-setup';
import { parseAmount, formatAmount } from '../../utils/bignumber';
import {
  // eslint-disable-next-line camelcase
  LiquidityGaugeV4_Interface,
} from '@angleprotocol/sdk/dist/constants/interfaces';
import { utils } from 'ethers';

async function main() {
  const governor = '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8';
  const guniRouter = '0x513E0a261af2D33B46F98b81FED547608fA2a03d';
  const usdcGauge = '0xEB7547a8a734b6fdDBB8Ce0C314a9E6485100a3C';
  const ethGauge = '0x3785Ce82be62a342052b9E5431e9D3a839cfB581';
  const guniUSDC = '0x2bD9F7974Bc0E4Cb19B8813F8Be6034F3E772add';
  const guniETH = '0x26C2251801D2cfb5461751c984Dc3eAA358bdf0f';
  const agEUR = '0x1a7e4e63778B4f12a199C062f3eFdD288afCBce8';
  const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

  // Choose the gauge you want to simulate here
  const guniToken = guniETH;
  const gauge = ethGauge;
  const token = weth;
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [gauge],
  });

  await network.provider.send('hardhat_setBalance', [gauge, '0x10000000000000000000000000000']);
  const gaugeSigner = await ethers.provider.getSigner(gauge);

  const guniRouterInterface = new utils.Interface([
    'function removeLiquidity(address pool, uint256 burnAmount, uint256 amount0Min, uint256 amount1Min, address receiver) external returns (uint256 amount0, uint256 amount1, uint128 liquidityBurned)',
  ]);

  const erc20Interface = new utils.Interface([
    'function balanceOf(address token) external view returns(uint256)',
    'function approve(address spender, uint256 amount)',
  ]);

  const toAddress = '0x48039dD47636154273B287f74C432cAC83Da97E2';

  const guniRouterContract = new ethers.Contract(guniRouter, guniRouterInterface, gaugeSigner);
  const guniTokenContract = new ethers.Contract(guniToken, erc20Interface, gaugeSigner);
  const tokenContract = new ethers.Contract(token, erc20Interface, gaugeSigner);
  const agEURContract = new ethers.Contract(agEUR, erc20Interface, gaugeSigner);

  const guniBalance = await guniTokenContract.balanceOf(gauge);
  console.log('GUNI Balance', guniBalance.toString());
  console.log(formatAmount.ether(guniBalance));

  await (
    await guniTokenContract.connect(gaugeSigner).approve(guniRouterContract.address, parseAmount.ether(1000000000))
  ).wait();
  console.log('Successfully approved the Router contract');

  await (await guniRouterContract.connect(gaugeSigner).removeLiquidity(guniToken, guniBalance, 0, 0, toAddress)).wait();
  console.log('Success removed liquidity');
  const balanceToken = await tokenContract.balanceOf(toAddress);
  const balanceAgEUR = await agEURContract.balanceOf(toAddress);
  console.log(balanceToken.toString(), balanceAgEUR.toString());
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
