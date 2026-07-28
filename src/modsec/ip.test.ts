import { isValidIpEntry } from './ip';

describe('IPv4', () => {
  it('принимает обычный адрес', () => {
    expect(isValidIpEntry('192.168.1.100')).toBe(true);
  });

  it('принимает адрес с маской', () => {
    expect(isValidIpEntry('10.0.0.0/8')).toBe(true);
  });

  it('отклоняет октет больше 255', () => {
    expect(isValidIpEntry('192.168.1.999')).toBe(false);
  });

  it('отклоняет октет с лишним нулём впереди', () => {
    expect(isValidIpEntry('192.168.001.1')).toBe(false);
  });

  it('отклоняет маску больше 32', () => {
    expect(isValidIpEntry('10.0.0.0/33')).toBe(false);
  });

  it('отклоняет неполный адрес', () => {
    expect(isValidIpEntry('192.168.1')).toBe(false);
  });

  it('отклоняет лишнюю точку', () => {
    expect(isValidIpEntry('192.168.1.1.1')).toBe(false);
  });
});

describe('IPv6', () => {
  it('принимает полный адрес', () => {
    expect(isValidIpEntry('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe(true);
  });

  it('принимает адрес со сжатыми нулями', () => {
    expect(isValidIpEntry('2001:db8::1')).toBe(true);
  });

  it('принимает петлю ::1', () => {
    expect(isValidIpEntry('::1')).toBe(true);
  });

  it('принимает адрес "все нули" ::', () => {
    expect(isValidIpEntry('::')).toBe(true);
  });

  it('принимает сеть с маской', () => {
    expect(isValidIpEntry('2001:db8:85a3:8d3:1319:8a2e:370:0/24')).toBe(true);
  });

  it('принимает адрес с внедрённым IPv4', () => {
    expect(isValidIpEntry('::ffff:192.168.1.1')).toBe(true);
  });

  it('отклоняет второе сжатие в одном адресе', () => {
    expect(isValidIpEntry('2001::db8::1')).toBe(false);
  });

  it('отклоняет лишнее двоеточие', () => {
    expect(isValidIpEntry('2001:::db8::1')).toBe(false);
  });

  it('отклоняет полный адрес без сжатия короче восьми групп', () => {
    expect(isValidIpEntry('2001:db8:85a3:8d3:1319:8a2e:370')).toBe(false);
  });

  it('отклоняет группу с недопустимым символом', () => {
    expect(isValidIpEntry('2001:db8::zzzz')).toBe(false);
  });

  it('отклоняет маску больше 128', () => {
    expect(isValidIpEntry('2001:db8::1/129')).toBe(false);
  });
});

describe('общие случаи', () => {
  it('отклоняет пустое значение', () => {
    expect(isValidIpEntry('')).toBe(false);
  });

  it('отклоняет произвольный текст', () => {
    expect(isValidIpEntry('not-an-ip')).toBe(false);
  });

  it('не трогает макрос — что в нём окажется, знает только движок', () => {
    expect(isValidIpEntry('%{tx.allowed_ips}')).toBe(true);
  });

  it('обрезает пробелы по краям', () => {
    expect(isValidIpEntry('  192.168.1.1  ')).toBe(true);
  });
});
