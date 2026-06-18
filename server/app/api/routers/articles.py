from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import distinct, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_admin, current_user
from app.db import get_session
from app.models import Article
from app.schemas import ArticleCreate, ArticleOut, ArticleUpdate
from app.services.bookings import audit

router = APIRouter(prefix="/articles", tags=["articles"])


@router.get("", response_model=list[ArticleOut])
async def list_articles(
    q: str | None = Query(default=None),
    category: str | None = None,
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[Article]:
    stmt = select(Article).order_by(Article.updated_at.desc())
    if category:
        stmt = stmt.where(Article.category == category)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Article.title.ilike(like), Article.body.ilike(like)))
    return list((await session.execute(stmt)).scalars().all())


@router.get("/categories", response_model=list[str])
async def list_categories(
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[str]:
    rows = (await session.execute(select(distinct(Article.category)).order_by(Article.category))).scalars().all()
    return list(rows)


@router.get("/{article_id}", response_model=ArticleOut)
async def get_article(
    article_id: int,
    _: tuple[int, str] = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> Article:
    article = await session.get(Article, article_id)
    if article is None:
        raise HTTPException(404, "Статья не найдена.")
    return article


@router.post("", response_model=ArticleOut, status_code=201)
async def create_article(
    payload: ArticleCreate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> Article:
    article = Article(**payload.model_dump())
    session.add(article)
    await session.flush()
    await audit(session, admin_id, "article.create", "article", article.id, article.title)
    await session.commit()
    await session.refresh(article)
    return article


@router.patch("/{article_id}", response_model=ArticleOut)
async def update_article(
    article_id: int,
    payload: ArticleUpdate,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> Article:
    article = await session.get(Article, article_id)
    if article is None:
        raise HTTPException(404, "Статья не найдена.")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(article, key, value)
    await audit(session, admin_id, "article.update", "article", article.id, article.title)
    await session.commit()
    await session.refresh(article)
    return article


@router.delete("/{article_id}", status_code=204)
async def delete_article(
    article_id: int,
    admin_id: int = Depends(current_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    article = await session.get(Article, article_id)
    if article is None:
        raise HTTPException(404, "Статья не найдена.")
    await session.delete(article)
    await audit(session, admin_id, "article.delete", "article", article_id, article.title)
    await session.commit()
