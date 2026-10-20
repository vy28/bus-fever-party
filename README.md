# Bus Party!

A cozy 3D bus-parking puzzle for the web, inspired by the "bus jam" genre (games like Bus Fever Party).
It's an original take on the gameplay; all the art is built in code with Three.js. No ads, no tracking, and it works offline.

## How to play
- Tap a vehicle and it drives the way its arrow points. If something is in the way, it bumps and honks.
- Vehicles that get out take a parking spot at the top. Passengers whose color matches climb on.
- When a vehicle is full, it leaves and frees its spot.
- If every spot is full and nobody at the front of the line can board, you're out of space.
- Grey "?" vehicles show their color once nothing blocks their path.
- Boosters: **+Spot** opens an extra parking spot, **Shuffle** mixes the colors of the vehicles still on the lot, and **VIP Lift** flies any vehicle straight to a spot.
- There are 500 levels. Every 5th is *Hard* and every 20th is *Super Hard*. The generator makes sure every level can be solved.

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
