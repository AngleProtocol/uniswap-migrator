import yargs from 'yargs';
import { DeployFunction } from 'hardhat-deploy/types';
import { CONTRACTS_ADDRESSES, ChainId, Interfaces } from '@angleprotocol/sdk';
import { BigNumber, BigNumberish } from 'ethers';
import { parseAmount } from '../utils/bignumber';

const argv = yargs.env('').boolean('ci').parseSync();

const func: DeployFunction = async ({ ethers, deployments, network }) => {
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  console.log('Deploying the new implemenation');
  console.log('LiquidityGaugeV4 Implementation Deployment');
  await deploy('LiquidityGaugeV4_Implementation', {
    contract: 'LiquidityGaugeV4',
    from: deployer.address,
    log: !argv.ci,
  });
  console.log('Success');
  console.log('');

  const implementationAddress = (await deployments.get('LiquidityGaugeV4_Implementation')).address;

  console.log('Now deploying the Migration contract');
  await deploy('UniMigrator', {
    contract: 'UniMigrator',
    from: deployer.address,
    log: !argv.ci,
  });
  console.log('Success');
  const migratorAddress = (await deployments.get('UniMigrator')).address;
  console.log(`Migrator Address ${migratorAddress}`);
  console.log('');

  // ------------------------------------------------------------------------------------------------------
  // ------------------------------------------- Mainnet fork tests ---------------------------------------
  // ------------------------------------------------------------------------------------------------------
  if (!network.live) {
    const multiSig = CONTRACTS_ADDRESSES[ChainId.MAINNET].GovernanceMultiSig! as string;
    const proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin;
    const gaugeUSDC = CONTRACTS_ADDRESSES[ChainId.MAINNET].ExternalStakings![0].liquidityGaugeAddress;
    const gaugeETH = CONTRACTS_ADDRESSES[ChainId.MAINNET].ExternalStakings![1].liquidityGaugeAddress;
    console.log("The two gauges we'll be working on are:");
    console.log(gaugeUSDC, gaugeETH);
    console.log(`Multisig address: ${multiSig}`);
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [multiSig],
    });
    await network.provider.send('hardhat_setBalance', [multiSig, '0x10000000000000000000000000000']);
    const multiSigSigner = await ethers.provider.getSigner(multiSig);
    const proxyAdminAddress: string = proxyAdmin !== undefined ? proxyAdmin : '0x';
    const contractProxyAdmin = new ethers.Contract(proxyAdminAddress, Interfaces.ProxyAdmin_Interface, multiSigSigner);
    console.log('Upgrading gauge USDC');
    await (await contractProxyAdmin.connect(multiSigSigner).upgrade(gaugeUSDC, implementationAddress)).wait();
    console.log('Success');
    console.log('');
    console.log('Upgrading gauge ETH');
    await (await contractProxyAdmin.connect(multiSigSigner).upgrade(gaugeETH, implementationAddress)).wait();
    console.log('Success');
  }
};

func.tags = ['gaugeImplem'];
export default func;
