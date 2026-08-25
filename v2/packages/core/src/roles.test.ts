import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  hasMinRole,
  isMembershipRole,
  requireRole,
  roleRank,
} from './roles.js';

describe('rôles', () => {
  it('ordonne la hiérarchie viewer < operator < admin < owner', () => {
    expect(roleRank('viewer')).toBeLessThan(roleRank('operator'));
    expect(roleRank('operator')).toBeLessThan(roleRank('admin'));
    expect(roleRank('admin')).toBeLessThan(roleRank('owner'));
  });

  it('hasMinRole : un owner satisfait admin, un viewer non', () => {
    expect(hasMinRole('owner', 'admin')).toBe(true);
    expect(hasMinRole('admin', 'admin')).toBe(true);
    expect(hasMinRole('viewer', 'operator')).toBe(false);
  });

  it('isMembershipRole filtre les valeurs inconnues', () => {
    expect(isMembershipRole('admin')).toBe(true);
    expect(isMembershipRole('superuser')).toBe(false);
  });

  it('requireRole laisse passer un rôle suffisant', () => {
    expect(requireRole('admin', 'operator')).toBe('admin');
  });

  it('requireRole lève ForbiddenError si le rôle est insuffisant', () => {
    expect(() => requireRole('viewer', 'admin')).toThrow(ForbiddenError);
  });

  it('requireRole lève ForbiddenError sans rôle (non-membre)', () => {
    expect(() => requireRole(null, 'viewer')).toThrow(ForbiddenError);
  });
});
