import { Shop, Longsword, Shield, Handaxe, LeatherArmour, PotionOfHealing, Shortbow, Arrow, Whip, ScaleMail, ChainMail, Dagger, Warhammer, Torch, HealersKit, Lockpick, TrapDisarmKit, Greataxe } from 'shared';

export const CHARACTER_CREATION_SHOP = new Shop({ buybackPercent: 100 });
[
  new Longsword(), new Shield(), new Handaxe(), new LeatherArmour(), new PotionOfHealing(),
  new Shortbow(), new Arrow(), new Whip(), new ScaleMail(), new ChainMail(), new Dagger(),
  new Warhammer(), new Torch(), new HealersKit(), new Lockpick(), new TrapDisarmKit(), new Greataxe(),
].forEach(item => CHARACTER_CREATION_SHOP.addItem(item));
