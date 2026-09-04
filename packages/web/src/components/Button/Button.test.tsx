import userEvent from "@testing-library/user-event";
import { Button } from "./Button";

import { screen, render } from '@testing-library/react';

describe('Button', () => {
  it('Should run callback when clicked', async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() => "WORKS")

    render(<Button onClick={submit} >It Works</Button>)

    const button = screen.getByRole("button")
    await user.click(button)
    expect(submit).toHaveBeenCalled()
  })
})
