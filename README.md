# Bus Party!

A cozy 3D bus-parking puzzle for the web, inspired by the "bus jam" genre (games like Bus Fever Party).
It's an original take on the gameplay; all the art is built in code with Three.js. No ads, no tracking, and it works offline.

## How to play
- Tap a vehicle and it drives the way its arrow points. If something is in the way, it bumps and honks.
- Vehicles that get out take a parking spot at the top. Passengers whose color matches climb on.
- When a vehicle is full, it leaves and frees its spot.
- If every spot is full and nobody at the front of the line can board, you're out of space.
- Grey "?" vehicles (from level 10) show their color once nothing blocks their path.
- There are 500 levels. Hard levels start at 9 and come every 5 levels (9, 14, 19…). Every 10th level from 20 is *Super Hard*. The generator makes sure every level can be solved with just the 4 free spots.

## Parking spots, boosters and coins
- Every level starts with **4 parking spots**. The 4 extra spots (yellow, locked) cost **50 coins each** and only last for that level.
- The **VIP spot** (gold, on the left) is only used by the VIP booster.
- **Shuffle** unlocks at level 6 and **VIP** at level 11. Each comes with 2 free uses, then costs coins (Shuffle 80, VIP 120).
  - Shuffle mixes the colors of the vehicles still in the lot. Colors only swap between vehicles of the same size, so every color keeps its seat count.
  - VIP lifts any vehicle, even a blocked one, into the VIP spot. You only pay when you pick the vehicle, so tapping VIP again to cancel is free.
- Coins come from winning: **+20** for a normal level, **+40** Hard, **+60** Super Hard, and +5 for replaying a level you've already beaten. You start with 100. There are no ads and no purchases.
- When you run out of space you can **+1 Spot** (50 coins), **Use VIP**, or **Try Again** for free.

## Put it on an iPhone home screen
1. Open the game's URL in **Safari**.
2. Tap the **Share** button, then **Add to Home Screen**.
3. It opens full screen like an app, saves your progress, and works without internet after the first load.

## Run locally
Any static file server works:
```
python3 -m http.server 8000
```
Then open http://localhost:8000.
