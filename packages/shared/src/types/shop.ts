import type { Item } from "./items.ts";

export class Shop {
  items: Item[] = [];
  buybackPercent: number;

  constructor(props: { buybackPercent: number }) {
    this.buybackPercent = props.buybackPercent;
  }

  addItem(item: Item): void {
    this.items.push(item);
  }

  sellPriceFor(item: Item): number {
    return Math.floor((item.cost ?? 0) * this.buybackPercent / 100);
  }
}
