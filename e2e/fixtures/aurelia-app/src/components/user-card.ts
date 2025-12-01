import { bindable } from 'aurelia';

export class UserCard {
  @bindable name = '';
  @bindable email = '';
  @bindable role = 'user';

  get initials() {
    return this.name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase();
  }

  get isAdmin() {
    return this.role === 'admin';
  }
}
