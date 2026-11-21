import type { DayWeather, WeatherType } from './types';
import { clamp, mulberry32 } from './rng';

/**
 * 生成一整季(春茶季)的气候数据，确定性可复现。
 * 模型: 基准气温随季节缓慢抬升 + 天气状态机(晴/多云/雨/雾/霜) + 海拔修正由茶园侧处理。
 * @param seed   随机种子
 * @param days   季节天数
 * @param baseTemp 季均基准气温 ℃
 */
export function generateClimate(
  seed: number,
  days = 60,
  baseTemp = 16.5,
): DayWeather[] {
  const rand = mulberry32(seed);
  const out: DayWeather[] = [];
  // 天气状态机权重: 春雨连绵，偶有倒春寒与辐射霜
  const transitions: Record<WeatherType, WeatherType[]> = {
    sun: ['sun', 'sun', 'cloud', 'cloud', 'rain', 'fog'],
    cloud: ['cloud', 'sun', 'rain', 'rain', 'fog', 'frost'],
    rain: ['rain', 'rain', 'cloud', 'cloud', 'fog', 'sun'],
    fog: ['fog', 'cloud', 'sun', 'rain'],
    frost: ['frost', 'sun', 'cloud'],
  };
  let type: WeatherType = rand() > 0.5 ? 'sun' : 'cloud';

  for (let day = 0; day < days; day++) {
    const choices: WeatherType[] = transitions[type];
    type = choices[Math.floor(rand() * choices.length)];
    // 季节推进: 气温每旬抬升约 0.9℃，季末回暖
    const seasonal = (day / days) * 5.4;
    const wave = Math.sin((day / 7.5) * Math.PI * 2) * 1.6;
    let avgTemp = baseTemp + seasonal + wave + (rand() - 0.5) * 1.4;

    let rainMm = 0;
    let humidity = 0.68;
    let sunHours = 5.5;

    switch (type) {
      case 'sun':
        sunHours = 7 + rand() * 3.5;
        humidity = 0.55 + rand() * 0.15;
        rainMm = 0;
        break;
      case 'cloud':
        sunHours = 1.5 + rand() * 3;
        humidity = 0.65 + rand() * 0.15;
        rainMm = rand() < 0.25 ? rand() * 3 : 0;
        break;
      case 'rain':
        sunHours = 0.2 + rand() * 1.4;
        humidity = 0.82 + rand() * 0.16;
        rainMm = 4 + rand() * 26;
        avgTemp -= 1.4;
        break;
      case 'fog':
        sunHours = 0.5 + rand() * 2;
        humidity = 0.88 + rand() * 0.1;
        rainMm = rand() * 1.2;
        avgTemp -= 0.8;
        break;
      case 'frost':
        sunHours = 4 + rand() * 3;
        humidity = 0.6 + rand() * 0.15;
        avgTemp = Math.min(avgTemp, 3.5);
        rainMm = 0;
        break;
    }
    humidity = clamp(humidity, 0.3, 1);

    const maxTemp = avgTemp + (type === 'sun' ? 5.5 : 3.2) + rand() * 1.5;
    const minTemp =
      type === 'frost'
        ? -2.2 - rand() * 1.5
        : avgTemp - (type === 'sun' ? 4.2 : 2.4) - rand();

    out.push({
      day,
      type,
      avgTemp: round(avgTemp),
      maxTemp: round(maxTemp),
      minTemp: round(minTemp),
      rainMm: round(rainMm),
      humidity: round(humidity),
      sunHours: round(sunHours),
    });
  }
  return out;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
