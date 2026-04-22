import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, username, password, displayName } = body;

    if (!email || !username || !password) {
      return NextResponse.json(
        { error: "Email, username, and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    const existingUser = await db.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Email or username already taken" },
        { status: 409 }
      );
    }

    const passwordHash = await hash(password, 12);

    const user = await db.user.create({
      data: {
        email,
        username,
        displayName: displayName || username,
        passwordHash,
      },
    });

    // Create a default server for the new user
    const server = await db.server.create({
      data: {
        name: `${user.displayName}'s Server`,
        ownerId: user.id,
        members: {
          create: {
            userId: user.id,
            role: "owner",
          },
        },
        channels: {
          createMany: {
            data: [
              { name: "general", type: "text" },
              { name: "random", type: "text" },
              { name: "General Voice", type: "voice" },
            ],
          },
        },
      },
    });

    return NextResponse.json(
      {
        message: "Account created successfully",
        userId: user.id,
        serverId: server.id,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
