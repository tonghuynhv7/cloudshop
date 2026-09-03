import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "1m", target: 50 },
    { duration: "2m", target: 200 },
    { duration: "5m", target: 500 },
    { duration: "2m", target: 0 },
  ],
};

export default function () {
  const res = http.get(
    "http://cloudshop-alb-1199436395.ap-southeast-1.elb.amazonaws.com/products"
  );

  check(res, {
    "status is 200": (r) => r.status === 200,
  });

  sleep(0.1);
}