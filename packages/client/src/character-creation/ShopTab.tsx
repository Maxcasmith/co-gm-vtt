import type { InventoryItem } from 'shared';
import { hasOriginFeat } from 'shared';
import emptyFrameIcon from '../assets/icons/Icon-Frame-Blue.jpg';
import { useCharacter } from './CharacterContext.tsx';
import { SHOP_ITEMS } from './srd.ts';

export default function ShopTab() {
  const c = useCharacter();
  // Origin feat Crafter: 20% discount on nonmagical items — everything in SHOP_ITEMS qualifies
  // (starting gear only, no magic items sold here).
  const hasCrafterDiscount = hasOriginFeat(c, 'Crafter');
  const priceFor = (cost: number) => hasCrafterDiscount ? Math.ceil(cost * 0.8) : cost;

  function buy(shopItemId: string) {
    const item = SHOP_ITEMS.find(i => i.id === shopItemId);
    const price = item ? priceFor(item.cost) : 0;
    if (!item || c.gold < price) return;

    const qty = item.quantityPerPurchase ?? 1;
    const existing = c.inventory.find(i => i.id === item.id);
    const { cost: _cost, quantityPerPurchase: _qpp, ...itemData } = item;
    const next: InventoryItem[] = existing
      ? c.inventory.map(i => i.id === item.id ? { ...i, quantity: i.quantity + qty } : i)
      : [...c.inventory, { ...itemData, quantity: qty } as InventoryItem];

    c.set('inventory', next);
    c.set('gold', c.gold - price);
  }

  function sell(itemId: string) {
    const shopItem = SHOP_ITEMS.find(i => i.id === itemId);
    const invItem  = c.inventory.find(i => i.id === itemId);
    if (!shopItem || !invItem) return;

    const qty = shopItem.quantityPerPurchase ?? 1;
    const refund = Math.floor(shopItem.cost / 2);
    const next: InventoryItem[] = invItem.quantity > qty
      ? c.inventory.map(i => i.id === itemId ? { ...i, quantity: i.quantity - qty } : i)
      : c.inventory.filter(i => i.id !== itemId);

    c.set('inventory', next);
    c.set('gold', c.gold + refund);
  }

  return (
    <div className="shop-layout">
      <div className="shop-col">
        <p className="shop-col-title">Your Inventory</p>
        <p className="shop-gold">{c.gold} gp remaining</p>
        {c.inventory.length === 0
          ? <p className="shop-inv-empty">Nothing yet — buy something!</p>
          : c.inventory.map(item => (
            <div key={item.id} className="shop-inv-item">
              <span className="shop-inv-item-name">{item.name}</span>
              {item.quantity > 1 && <span className="shop-inv-item-qty">×{item.quantity}</span>}
              <button className="shop-sell-btn" onClick={() => sell(item.id)}>Sell</button>
            </div>
          ))
        }
      </div>

      <div className="shop-col">
        <p className="shop-col-title">Shop</p>
        {SHOP_ITEMS.map(item => (
          <div key={item.id} className="shop-item">
            <img className="shop-item-icon" src={item.iconPath || emptyFrameIcon} alt="" />
            <div className="shop-item-info">
              <p className="shop-item-name">{item.name}</p>
              <p className="shop-item-desc">{item.description}</p>
            </div>
            <div className="shop-item-right">
              <span className="shop-item-cost">
                {hasCrafterDiscount && priceFor(item.cost) !== item.cost && (
                  <span className="shop-item-cost-original">{item.cost} gp</span>
                )}
                {priceFor(item.cost)} gp
              </span>
              <button
                className="shop-buy-btn"
                disabled={c.gold < priceFor(item.cost)}
                onClick={() => buy(item.id)}
              >Buy</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
