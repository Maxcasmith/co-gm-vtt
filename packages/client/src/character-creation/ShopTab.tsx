import { useState } from 'react';
import type { Item, InventoryItem } from 'shared';
import { hasOriginFeat } from 'shared';
import { Button } from '../components/Button/Button.tsx';
import ItemIcon from '../ItemIcon.tsx';
import { useCharacter } from './CharacterContext.tsx';
import { CHARACTER_CREATION_SHOP } from './characterCreationShop.ts';

const CATEGORY_LABELS: Record<string, string> = {
  weapon: 'Weapons',
  armor: 'Armor',
  ammunition: 'Ammunition',
  consumable: 'Consumables',
};
const CATEGORY_ORDER = ['weapon', 'armor', 'ammunition', 'consumable'];
const categoryOf = (item: Item) => item.type && item.type in CATEGORY_LABELS ? item.type : 'consumable';

export default function ShopTab() {
  const c = useCharacter();
  const [category, setCategory] = useState('all');
  const [nameFilter, setNameFilter] = useState('');
  const query = nameFilter.trim().toLowerCase();
  const groups = CATEGORY_ORDER
    .map(key => ({
      key,
      label: CATEGORY_LABELS[key],
      items: CHARACTER_CREATION_SHOP.items.filter(i => categoryOf(i) === key && i.name.toLowerCase().includes(query)),
    }))
    .filter(g => g.items.length > 0 && (category === 'all' || category === g.key));
  // Origin feat Crafter: 20% discount on nonmagical items — everything in this shop qualifies
  // (starting gear only, no magic items sold here).
  const hasCrafterDiscount = hasOriginFeat(c, 'Crafter');
  const priceFor = (cost: number) => hasCrafterDiscount ? Math.ceil(cost * 0.8) : cost;

  function buy(itemId: string) {
    const item = CHARACTER_CREATION_SHOP.items.find(i => i.id === itemId);
    const price = item ? priceFor(item.cost ?? 0) : 0;
    if (!item || c.gold < price) return;

    const qty = item.quantity;
    const existing = c.inventory.find(i => i.id === item.id);
    const next: InventoryItem[] = existing
      ? c.inventory.map(i => i.id === item.id ? { ...i, quantity: i.quantity + qty } : i)
      : [...c.inventory, { ...item, quantity: qty }];

    c.set('inventory', next);
    c.set('gold', c.gold - price);
  }

  function sell(itemId: string) {
    const shopItem = CHARACTER_CREATION_SHOP.items.find(i => i.id === itemId);
    const invItem  = c.inventory.find(i => i.id === itemId);
    if (!shopItem || !invItem) return;

    const qty = shopItem.quantity;
    const refund = CHARACTER_CREATION_SHOP.sellPriceFor(shopItem);
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
        <div className="shop-scroll">
          {c.inventory.length === 0
            ? <p className="shop-inv-empty">Nothing yet — buy something!</p>
            : c.inventory.map(item => (
              <div key={item.id} className="shop-inv-item">
                <span className="shop-inv-item-name">{item.name}</span>
                {item.quantity > 1 && <span className="shop-inv-item-qty">×{item.quantity}</span>}
                <Button variant="ghost" className="shop-sell-btn" onClick={() => sell(item.id)}>Sell</Button>
              </div>
            ))
          }
        </div>
      </div>

      <div className="shop-col">
        <div className="shop-col-header">
          <input
            className="shop-filter-input"
            type="text"
            placeholder="Search…"
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
          />
          <select className="shop-filter-select" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="all">All</option>
            {CATEGORY_ORDER.map(key => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}
          </select>
        </div>
        <div className="shop-scroll">
          {groups.map(group => (
            <div key={group.key} className="shop-category-group">
              <p className="shop-category-title">{group.label}</p>
              {group.items.map(item => (
                <div key={item.id} className="shop-item">
                  <ItemIcon className="shop-item-icon" name={item.name} iconPath={item.iconPath} />
                  <div className="shop-item-info">
                    <p className="shop-item-name">{item.name}</p>
                    <p className="shop-item-desc">{item.description}</p>
                  </div>
                  <div className="shop-item-right">
                    <span className="shop-item-cost">
                      {hasCrafterDiscount && priceFor(item.cost ?? 0) !== (item.cost ?? 0) && (
                        <span className="shop-item-cost-original">{item.cost} gp</span>
                      )}
                      {priceFor(item.cost ?? 0)} gp
                    </span>
                    <Button
                      variant="ghost"
                      className="shop-buy-btn"
                      disabled={c.gold < priceFor(item.cost ?? 0)}
                      onClick={() => buy(item.id)}
                    >Buy</Button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
