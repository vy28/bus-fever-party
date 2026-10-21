# Bus Party!

A cozy 3D bus-parking puzzle for the web, inspired by the "bus jam" genre (games like Bus Fever Party).
It's an original take on the gameplay; all the art is built in code with Three.js. No ads, no tracking, and it works offline.

## How to play
- Tap a vehicle and it drives the way its arrow points. If something is in the way, it bumps and honks.
- Vehicles that get out park in the row of spots in the middle of the screen.
- The passengers ride a loop that keeps going around. Anyone passing the gate who matches a parked vehicle's color hops on. When people board, more join the loop from the side arms.
- When a vehicle is full it drives off and frees its spot.
- If every spot is full and nobody on the loop can board, you're out of space.
- Grey "?" vehicles (from level 10) show their color once nothing blocks their path.
- There are 500 levels. Hard levels start at 9 and come every 5 levels (9, 14, 19…). Every 10th level from 20 is *Super Hard*. The generator plays every level through before you see it, so each one can be solved with just the 4 free spots.

## Parking spots, boosters and coins
- Every level starts with **4 parking spots**. The 3 green "+" spots cost **50 coins each** and only last for that level.
- The gold **VIP** spot is only used by the VIP booster.
- **Jumble** unlocks at level 6, **Arrange** at 8 and **VIP** at 11. Each comes with 2 free uses, then costs coins (Jumble 80, Arrange 90, VIP 120).
  - Jumble mixes the colors of the vehicles still in the lot. Colors only swap between vehicles of the same size, so every color keeps its seat count.
  - Arrange sends everyone who matches a parked vehicle straight to it, wherever they are in the line.
  - VIP lifts any vehicle, even a blocked one, into the VIP spot. You only pay when you pick the vehicle.
- Coins come from winning: **+20** for a normal level, **+40** Hard, **+60** Super Hard, and +5 for replaying a level you've already beaten. You start with 100. There are no ads and no purchases.
- When you run out of space you can buy **+1 Spot** (50 coins), **Use VIP**, or **Try Again** for free.
- Closing the game mid-level saves your place. **Settings → Move progress** copies your progress between Safari and the Home Screen app.

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
