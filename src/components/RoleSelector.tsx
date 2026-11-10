import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, UserRound } from 'lucide-react';
import type { Role } from '../types';
import { roles, identities } from '../utils/core';

export function RoleSelector({ value, onChange, form = false }: { value: Role; onChange: (value: Role) => void; form?: boolean }) {
  const display = (value === 'Planner' ? 'Logistics Planner' : value);
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button type="button" className={form ? 'w-role-trigger w-role-form' : 'w-role-trigger w-role-header'} aria-label={'Demo role: ' + display}>
        {!form && <span className="w-role-avatar" aria-hidden="true">{identities[value].name.split(' ').slice(-1)[0]?.charAt(0) || 'W'}</span>}
        {form && <UserRound size={17} aria-hidden="true" />}
        <span className="w-role-label">
          {!form && <small>DEMO ROLE</small>}
          <strong>{display}</strong>
        </span>
        <ChevronDown size={17} className="w-role-chevron" aria-hidden="true" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="w-dropdown w-role-menu" sideOffset={10} align={form ? 'start' : 'end'} collisionPadding={12}>
        <div className="w-dropdown-heading">Switch demonstration role</div>
        <DropdownMenu.RadioGroup value={value} onValueChange={r => onChange(r as Role)}>
          {roles.map(r => <DropdownMenu.RadioItem key={r} value={r} className="w-dropdown-item w-role-option">
            <span className="w-dropdown-check"><DropdownMenu.ItemIndicator><Check size={17} strokeWidth={2.6} /></DropdownMenu.ItemIndicator></span>
            <span>{r === 'Planner' ? 'Logistics Planner' : r}</span>
          </DropdownMenu.RadioItem>)}
        </DropdownMenu.RadioGroup>
        <div className="w-dropdown-caption">Synthetic academic roles — not real accounts</div>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
