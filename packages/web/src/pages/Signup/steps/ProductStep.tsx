import { useFormContext } from '../../../components/Form/Form';
import { CheckIcon } from '../../../components/icons/Icons';
import { PRODUCTS } from '../../../data/products';
import type { SignupForm } from '../journeyForm';

export function ProductStep() {
  const formContext = useFormContext() as
    | { form: SignupForm; setForm: (f: Partial<SignupForm>) => void }
    | undefined;
  const selected = formContext?.form.productId;
  const selectedPlan = PRODUCTS.find(plan => plan.id === selected);

  return (
    <div className="journey--product-layout">
      <div className="journey--products">
        {PRODUCTS.map(plan => (
          <button
            type="button"
            key={plan.id}
            className={`journey--product-card${selected === plan.id ? ' journey--product-card--selected' : ''}`}
            onClick={() => formContext?.setForm({ productId: plan.id })}
          >
            {selected === plan.id && <CheckIcon className="journey--product-card--check" />}
            <plan.icon className="journey--product-card--icon" />
            <h3 className="journey--product-card--title">{plan.title}</h3>
            <p className="journey--product-card--tagline">{plan.tagline}</p>
            <p className="journey--product-card--price">{plan.price}<span>{plan.priceSuffix}</span></p>
          </button>
        ))}
      </div>

      {selectedPlan && (
        <aside className="journey--product-info">
          <span className="journey--product-info--eyebrow">Your Selection</span>
          <selectedPlan.icon className="journey--product-info--icon" />
          <h3 className="journey--product-info--title">{selectedPlan.title}</h3>
          <p className="journey--product-info--tagline">{selectedPlan.tagline}</p>
          <p className="journey--product-info--price">{selectedPlan.price}<span>{selectedPlan.priceSuffix}</span></p>
          <ul className="journey--product-info--features">
            {selectedPlan.features.map(f => (
              <li key={f}><CheckIcon className="journey--product-info--check" /> {f}</li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
