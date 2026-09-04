import { SocketRateLimiter } from './socket-rate-limiter';

describe('SocketRateLimiter', () => {
  it('autorise jusqu’à la limite puis refuse dans la même fenêtre', () => {
    const limiter = new SocketRateLimiter(3, 1000);
    expect(limiter.consume('socket-1')).toBe(true);
    expect(limiter.consume('socket-1')).toBe(true);
    expect(limiter.consume('socket-1')).toBe(true);
    expect(limiter.consume('socket-1')).toBe(false);
  });

  it('compte chaque clé (socket) indépendamment', () => {
    const limiter = new SocketRateLimiter(1, 1000);
    expect(limiter.consume('socket-1')).toBe(true);
    expect(limiter.consume('socket-2')).toBe(true);
    expect(limiter.consume('socket-1')).toBe(false);
    expect(limiter.consume('socket-2')).toBe(false);
  });

  it('autorise à nouveau une fois la fenêtre glissante écoulée', async () => {
    const limiter = new SocketRateLimiter(1, 20);
    expect(limiter.consume('socket-1')).toBe(true);
    expect(limiter.consume('socket-1')).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(limiter.consume('socket-1')).toBe(true);
  });

  it('clear() oublie une clé, qui repart avec un quota neuf', () => {
    const limiter = new SocketRateLimiter(1, 1000);
    expect(limiter.consume('socket-1')).toBe(true);
    expect(limiter.consume('socket-1')).toBe(false);
    limiter.clear('socket-1');
    expect(limiter.consume('socket-1')).toBe(true);
  });
});
