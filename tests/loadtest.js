import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 20 },
    { duration: '2m', target: 50 },
    { duration: '2m', target: 100 },
    { duration: '2m', target: 100 },
    { duration: '1m', target: 0 },
  ],
};

export default function () {
  const res = http.get(
    'http://cloudshop-alb-1199436395.ap-southeast-1.elb.amazonaws.com/health'
  );

  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  sleep(0.1);
}
