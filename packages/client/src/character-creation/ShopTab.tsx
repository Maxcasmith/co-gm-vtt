import type { InventoryItem } from 'shared';
import { useCharacter } from './CharacterContext.tsx';
import { SHOP_ITEMS } from './srd.ts';

export default function ShopTab() {
  const c = useCharacter();

  function buy(shopItemId: string) {
    const item = SHOP_ITEMS.find(i => i.id === shopItemId);
    if (!item || c.gold < item.cost) return;

    const existing = c.inventory.find(i => i.id === item.id);
    const next: InventoryItem[] = existing
      ? c.inventory.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i)
      : [...c.inventory, { id: item.id, name: item.name, quantity: 1, description: item.description }];

    c.set('inventory', next);
    c.set('gold', c.gold - item.cost);
  }

  function sell(itemId: string) {
    const shopItem = SHOP_ITEMS.find(i => i.id === itemId);
    const invItem  = c.inventory.find(i => i.id === itemId);
    if (!shopItem || !invItem) return;

    const refund = Math.floor(shopItem.cost / 2);
    const next: InventoryItem[] = invItem.quantity > 1
      ? c.inventory.map(i => i.id === itemId ? { ...i, quantity: i.quantity - 1 } : i)
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
            <div className="shop-item-info">
              <p className="shop-item-name">{item.name}</p>
              <p className="shop-item-desc">{item.description}</p>
            </div>
            <div className="shop-item-right">
              <span className="shop-item-cost">{item.cost} gp</span>
              <button
                className="shop-buy-btn"
                disabled={c.gold < item.cost}
                onClick={() => buy(item.id)}
              >Buy</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
