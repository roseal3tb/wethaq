import React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

/**
 * Native option markup as data, Radix as the keyboard-accessible presentation
 * This keeps existing page state and change callbacks while using one themed menu
 */
export type NiceSelectProps = {
  value: string | number;
  onChange: (event: { target: { value: string } }) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
};
export function NiceSelect({ value, onChange, children, className = '', disabled, 'aria-label': ariaLabel }: NiceSelectProps) {
  const options = React.Children.toArray(children).filter(React.isValidElement)
    .filter((c): c is React.ReactElement<React.OptionHTMLAttributes<HTMLOptionElement>> => React.isValidElement(c) && c.type === 'option')
    .map((option, index) => {
      const label = React.Children.toArray(option.props.children).map(x => typeof x === 'string' || typeof x === 'number' ? String(x) : '').join('');
      return { label, value: String(option.props.value ?? label), disabled: Boolean(option.props.disabled), key: option.key ?? index };
    });
  return <SelectPrimitive.Root value={String(value)} disabled={disabled} onValueChange={v => onChange({ target: { value: v } })}>
    <SelectPrimitive.Trigger aria-label={ariaLabel} className={`w-select-trigger ${className}`}>
      <SelectPrimitive.Value placeholder="Choose an option" />
      <SelectPrimitive.Icon asChild><ChevronDown size={16} aria-hidden="true" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content position="popper" sideOffset={7} collisionPadding={12} className="w-select-menu">
        <SelectPrimitive.ScrollUpButton className="w-select-scroll" aria-label="Scroll up">⌃</SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport className="w-select-viewport">
          {options.map(o => <SelectPrimitive.Item className="w-select-item" key={o.key} value={o.value} disabled={o.disabled}>
            <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
            <SelectPrimitive.ItemIndicator className="w-select-indicator"><Check size={15} strokeWidth={2.6} /></SelectPrimitive.ItemIndicator>
          </SelectPrimitive.Item>)}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="w-select-scroll" aria-label="Scroll down">⌄</SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>;
}
