export class App {
  message = 'Aurelia 2 E2E Test App';
  counter = 0;

  users = [
    { name: 'John Doe', email: 'john@example.com', role: 'admin' },
    { name: 'Jane Smith', email: 'jane@example.com', role: 'user' },
  ];

  increment() {
    this.counter++;
  }

  addUser() {
    const id = this.users.length + 1;
    this.users.push({
      name: `User ${id}`,
      email: `user${id}@example.com`,
      role: 'user'
    });
  }
}
